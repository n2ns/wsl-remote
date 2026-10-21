import * as cp from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import * as vscode from 'vscode';
import { Deferred } from '../common/async.js';
import type { Logger } from '../common/logger.js';
import type { ProductInfo } from '../common/productInfo.js';
import { validateDownloadUrlTemplate, validateExtensionId } from '../common/validate.js';
import type { WslManager } from '../wsl/wslManager.js';

/** The URL VSCodium publishes its remote extension host under; used when product.json has no template. */
export const DEFAULT_DOWNLOAD_URL_TEMPLATE =
  'https://github.com/VSCodium/vscodium/releases/download/${version}/vscodium-reh-${os}-${arch}-${version}.tar.gz';

export interface ServerStartOptions {
  readonly distro: string;
  readonly product: ProductInfo;
  readonly downloadUrlTemplate: string | undefined;
  readonly extensionIds: readonly string[];
  readonly sourceEnvSetup: boolean;
  readonly debug: boolean;
  readonly startTimeoutMs: number;
  readonly lockTimeoutSeconds: number;
  readonly connectHost: 'auto' | 'localhost' | 'distroIp';
}

export interface ServerInfo {
  readonly port: number;
  readonly connectionToken: string;
  /** First IPv4 address of the distribution, when the script could determine it. */
  readonly distroIp: string | undefined;
  readonly status: ReadonlyMap<string, string>;
}

export class ServerStartError extends Error {
  constructor(
    message: string,
    /** True when retrying later may succeed (network, lock wait); false for configuration problems. */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'ServerStartError';
  }
}

const SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'server-setup.sh');
let scriptCache: Buffer | undefined;

function loadScript(): Buffer {
  if (!scriptCache) {
    const text = fs.readFileSync(SCRIPT_PATH, 'utf8').replace(/\r\n/g, '\n');
    scriptCache = Buffer.from(text, 'utf8');
  }
  return scriptCache;
}

/**
 * One running server inside one distribution, owned by one window. The server process is a child
 * of this extension host; the setup script stops it as soon as stdin closes, so a crashed or closed
 * window never leaves a server behind.
 */
export class ServerProcess implements vscode.Disposable {
  private readonly exited = new Deferred<number | null>();
  private disposed = false;
  private readonly onDidExitEmitter = new vscode.EventEmitter<number | null>();
  readonly onDidExit = this.onDidExitEmitter.event;

  private constructor(
    readonly distro: string,
    readonly info: ServerInfo,
    private readonly child: cp.ChildProcess,
    private readonly logger: Logger,
  ) {
    void this.exited.promise.then((code) => {
      this.logger.info(`Server for ${distro} exited with code ${String(code)}`);
      this.onDidExitEmitter.fire(code);
    });
  }

  get isRunning(): boolean {
    return !this.exited.isSettled && !this.disposed;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // Closing stdin makes the script kill the server; the kill below is the fallback.
    try {
      this.child.stdin?.end();
    } catch {
      // already closed
    }
    setTimeout(() => {
      if (!this.exited.isSettled) {
        this.child.kill();
      }
    }, 3000).unref();
    this.onDidExitEmitter.dispose();
  }

  static async start(wsl: WslManager, logger: Logger, options: ServerStartOptions): Promise<ServerProcess> {
    const { product } = options;
    const template = validateDownloadUrlTemplate(options.downloadUrlTemplate ?? product.serverDownloadUrlTemplate ?? DEFAULT_DOWNLOAD_URL_TEMPLATE);
    const extensions = options.extensionIds.map(validateExtensionId);
    const id = crypto.randomBytes(6).toString('hex');
    const token = crypto.randomUUID();
    const script = loadScript();

    const env: Record<string, string> = {
      WR_ID: id,
      WR_COMMIT: product.commit,
      WR_QUALITY: product.quality,
      WR_VERSION: product.version,
      WR_RELEASE: product.release ?? '',
      WR_SERVER_APP: product.serverApplicationName,
      WR_DATA_DIR: product.serverDataFolderName,
      WR_URL_TEMPLATE: template,
      WR_TOKEN: token,
      WR_EXTENSIONS: extensions.join(' '),
      WR_ENV_SETUP: options.sourceEnvSetup ? '1' : '0',
      WR_DEBUG: options.debug ? '1' : '0',
      WR_LOCK_TIMEOUT: String(options.lockTimeoutSeconds),
      WR_CONNECT_HOST: options.connectHost,
    };

    // `head -c N` takes exactly the script from stdin; the rest of stdin stays open as the
    // keep-alive channel the script watches. Nothing user-controlled is in this command line, and
    // the script never touches the disk.
    const bootstrap = `exec sh -c "$(head -c ${script.length})" server-setup.sh`;
    logger.info(`Starting ${product.serverApplicationName} in ${options.distro} (commit ${product.commit.slice(0, 10)})`);
    const child = wsl.spawnLinux(options.distro, 'sh', ['-c', bootstrap], { env });

    const status = new Map<string, string>();
    const ready = new Deferred<ServerInfo>();
    const exited = new Deferred<number | null>();
    const recent: string[] = [];
    const markerPrefix = `WR[${id}] `;

    // Waiting for another window's installation may take up to the lock timeout on top of the start timeout.
    let timer: NodeJS.Timeout | undefined;
    let deadline = Date.now();
    let totalMs = 0;
    const extendTimeout = (ms: number): void => {
      clearTimeout(timer);
      deadline += ms;
      totalMs += ms;
      timer = setTimeout(() => ready.reject(new ServerStartError(`Starting the server timed out after ${Math.round(totalMs / 1000)}s`, true)), deadline - Date.now());
    };

    const handleLine = (line: string): void => {
      if (line.length === 0) {
        return;
      }
      recent.push(line);
      if (recent.length > 40) {
        recent.shift();
      }
      if (line.startsWith(markerPrefix)) {
        const body = line.slice(markerPrefix.length);
        logger.info(`[${options.distro}] ${body}`);
        for (const match of body.matchAll(/(\w+)=(\S*)/g)) {
          status.set(match[1] ?? '', match[2] ?? '');
        }
        if (body.startsWith('lock=waiting') && !ready.isSettled) {
          extendTimeout(options.lockTimeoutSeconds * 1000);
        }
        if (body.startsWith('error=')) {
          const message = body.slice('error='.length);
          ready.reject(new ServerStartError(message, /download|timed out|lock|checksum|empty/i.test(message)));
        }
        return;
      }
      logger.debug(`[${options.distro}] ${line}`);
      const listening = /Extension host agent listening on (\d+)/.exec(line);
      if (listening && !ready.isSettled) {
        ready.resolve({
          port: Number(listening[1]),
          connectionToken: token,
          distroIp: status.get('ip') || undefined,
          status,
        });
      }
    };

    readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', handleLine);
    readline.createInterface({ input: child.stderr, crlfDelay: Infinity }).on('line', (line) => {
      recent.push(line);
      logger.debug(`[${options.distro}] stderr: ${line}`);
    });
    child.once('error', (error) => {
      ready.reject(new ServerStartError(`Could not start wsl.exe: ${error.message}`, false));
      exited.resolve(null);
    });
    child.once('close', (code) => {
      exited.resolve(code);
      if (!ready.isSettled) {
        const tail = recent.slice(-8).join('\n');
        ready.reject(new ServerStartError(`The server setup script exited with code ${String(code)} before the server was listening.\n${tail}`, true));
      }
    });
    child.stdin.on('error', () => {
      // EPIPE when the child is already gone; the close handler reports it
    });
    child.stdin.write(script);

    extendTimeout(options.startTimeoutMs);
    let info: ServerInfo;
    try {
      info = await ready.promise.finally(() => clearTimeout(timer));
    } catch (error) {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
      child.kill();
      throw error instanceof ServerStartError ? error : new ServerStartError(error instanceof Error ? error.message : String(error), true);
    }
    const process = new ServerProcess(options.distro, info, child, logger);
    void exited.promise.then((code) => process.exited.resolve(code));
    return process;
  }
}
