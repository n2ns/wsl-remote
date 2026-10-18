import * as cp from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { Logger } from '../common/logger.js';
import { isValidDistroName, validateDistroName, validateEnvName } from '../common/validate.js';

export const WSL_EXE = 'wsl.exe';

export interface WslDistro {
  readonly name: string;
  readonly isDefault: boolean;
  /** Running, Stopped, Installing, ... as printed by wsl.exe. */
  readonly state: string;
  readonly version: string;
}

export interface WslOnlineDistro {
  readonly name: string;
  readonly friendlyName: string;
}

export interface WslCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface WslSpawnOptions {
  /** Environment variables to add to wsl.exe's environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Names of variables (from `env` or the process environment) that WSL must forward into Linux. */
  readonly forward?: readonly string[];
  /** Flags appended to each forwarded name in WSLENV, e.g. `/p` to translate a path. */
  readonly forwardFlags?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

/**
 * Everything that talks to wsl.exe. Commands are always spawned with an argument array, never through
 * a shell, so distribution names and paths cannot be interpreted as syntax on the Windows side.
 */
export class WslManager {
  constructor(private readonly logger: Logger) {}

  /** `wsl.exe --list --verbose`, tolerant of the UTF-16 output, BOM, localized headers and blank lines. */
  async listDistros(): Promise<WslDistro[]> {
    const result = await this.runManagement(['--list', '--verbose']);
    if (result.exitCode !== 0) {
      // wsl.exe exits with 1 and prints a hint when no distribution is installed at all. The hint is localized;
      // the English and the Chinese (zh-CN, written as escapes) wordings are recognized, any other locale falls
      // through to the error below, which carries wsl.exe's own message.
      if (/no installed distributions|\u6ca1\u6709\u5df2\u5b89\u88c5\u7684\u5206\u53d1/i.test(result.stdout + result.stderr)) {
        return [];
      }
      throw new Error(`wsl.exe --list --verbose exited with code ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`);
    }
    return parseListVerbose(result.stdout);
  }

  async listOnlineDistros(): Promise<WslOnlineDistro[]> {
    const result = await this.runManagement(['--list', '--online']);
    if (result.exitCode !== 0) {
      throw new Error(`wsl.exe --list --online exited with code ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`);
    }
    return parseListOnline(result.stdout);
  }

  async setDefaultDistro(distro: string): Promise<void> {
    validateDistroName(distro);
    const result = await this.runManagement(['--set-default', distro]);
    if (result.exitCode !== 0) {
      throw new Error(`wsl.exe --set-default ${distro} exited with code ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`);
    }
  }

  async unregisterDistro(distro: string): Promise<void> {
    validateDistroName(distro);
    const result = await this.runManagement(['--unregister', distro]);
    if (result.exitCode !== 0) {
      throw new Error(`wsl.exe --unregister ${distro} exited with code ${result.exitCode}: ${(result.stderr || result.stdout).trim()}`);
    }
  }

  /** Runs a Linux command and collects its output (UTF-8). */
  async exec(distro: string, command: string, args: readonly string[], options: WslSpawnOptions = {}): Promise<WslCommandResult> {
    validateDistroName(distro);
    const child = this.spawnLinux(distro, command, args, options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? -1));
    });
    return { exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
  }

  /** Spawns `wsl.exe --distribution <distro> --exec <command> <args...>` with piped stdio and returns the child. */
  spawnLinux(distro: string, command: string, args: readonly string[], options: WslSpawnOptions = {}): cp.ChildProcessByStdio<Writable, Readable, Readable> {
    validateDistroName(distro);
    const env = buildEnvironment(options);
    const wslArgs = ['--distribution', distro, '--exec', command, ...args];
    this.logger.trace(`spawn ${WSL_EXE} ${wslArgs.join(' ')}`);
    return cp.spawn(WSL_EXE, wslArgs, {
      env,
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  private async runManagement(args: string[]): Promise<WslCommandResult> {
    this.logger.trace(`run ${WSL_EXE} ${args.join(' ')}`);
    return new Promise<WslCommandResult>((resolve, reject) => {
      const child = cp.spawn(WSL_EXE, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', reject);
      child.once('close', (code) => {
        resolve({
          exitCode: code ?? -1,
          stdout: decodeWslOutput(Buffer.concat(stdout)),
          stderr: decodeWslOutput(Buffer.concat(stderr)),
        });
      });
    });
  }
}

/** Builds the Windows environment for wsl.exe, including the WSLENV list that forwards our variables. */
export function buildEnvironment(options: WslSpawnOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...options.env };
  const forward = options.forward ?? Object.keys(options.env ?? {});
  if (forward.length > 0) {
    const entries = forward.map((name) => validateEnvName(name) + (options.forwardFlags?.[name] ?? ''));
    const existing = process.env['WSLENV'];
    env['WSLENV'] = existing ? `${entries.join(':')}:${existing}` : entries.join(':');
  }
  return env;
}

/** Management commands print UTF-16LE on Windows; interop output of Linux processes is UTF-8. Detect by NUL bytes. */
export function decodeWslOutput(buffer: Buffer): string {
  if (buffer.length === 0) {
    return '';
  }
  let zeros = 0;
  const sample = Math.min(buffer.length, 256);
  for (let i = 0; i < sample; i++) {
    if (buffer[i] === 0) {
      zeros++;
    }
  }
  const text = zeros > sample / 4 ? buffer.toString('utf16le') : buffer.toString('utf8');
  return text.replace(/^﻿/, '').replace(/\0/g, '');
}

/**
 * Parses the table printed by `wsl.exe --list --verbose`:
 *
 *       NAME            STATE           VERSION
 *     * Ubuntu_26       Running         2
 *       Ubuntu_26_Dev   Stopped         2
 *
 * The header is localized, so rows are recognized by shape, not by the header text.
 */
export function parseListVerbose(output: string): WslDistro[] {
  const distros: WslDistro[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) {
      continue;
    }
    const match = /^(\*?)\s*(\S+)\s+(\S+)\s+(\d)\s*$/.exec(line);
    if (!match) {
      continue; // header or an unexpected line
    }
    const [, star, name, state, version] = match;
    if (!name || !state || !version || !isValidDistroName(name)) {
      continue;
    }
    distros.push({ name, isDefault: star === '*', state, version });
  }
  return distros;
}

/** Parses `wsl.exe --list --online`: a header block, then `NAME  FRIENDLY NAME` rows. */
export function parseListOnline(output: string): WslOnlineDistro[] {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd());
  const headerIndex = lines.findIndex((line) => /^\s*NAME\s+FRIENDLY NAME\s*$/i.test(line));
  const rows = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;
  const distros: WslOnlineDistro[] = [];
  for (const line of rows) {
    const match = /^\s*(\S+)\s+(\S.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, name, friendlyName] = match;
    if (name && friendlyName && isValidDistroName(name)) {
      distros.push({ name, friendlyName: friendlyName.trim() });
    }
  }
  return distros;
}
