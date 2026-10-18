import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser';
import * as vscode from 'vscode';
import type { Logger } from './common/logger.js';

export const EXTENSION_ID = 'n2ns.wsl-remote';
const DISMISSED_KEY = 'proposedApi.promptDismissed';

/** Where the running editor reads its runtime arguments from. */
export function argvJsonPath(dataFolderName: string, env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const portable = env['VSCODE_PORTABLE'];
  if (portable && portable.length > 0) {
    return path.join(portable, 'argv.json');
  }
  return path.join(home, dataFolderName, 'argv.json');
}

export type ArgvEditResult = { changed: true; text: string } | { changed: false; reason: 'already-enabled' | 'invalid-json'; text: string };

/**
 * Returns the argv.json text with `enable-proposed-api` listing `extensionId`. Comments and
 * formatting of the existing file survive because the change is a minimal JSONC edit.
 */
export function addProposedApiEntry(text: string, extensionId: string): ArgvEditResult {
  const source = text.trim().length === 0 ? '{\n}\n' : text;
  const errors: ParseError[] = [];
  const parsed: unknown = parse(source, errors, { allowTrailingComma: true });
  if (errors.length > 0 || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { changed: false, reason: 'invalid-json', text };
  }
  const existing = (parsed as Record<string, unknown>)['enable-proposed-api'];
  const list = Array.isArray(existing) ? existing.filter((item): item is string => typeof item === 'string') : [];
  if (list.includes(extensionId)) {
    return { changed: false, reason: 'already-enabled', text };
  }
  const next = Array.isArray(existing) ? [...list, extensionId] : [extensionId];
  const edits = modify(source, ['enable-proposed-api'], next, {
    formattingOptions: { insertSpaces: true, tabSize: 4, eol: detectEol(source) },
  });
  return { changed: true, text: applyEdits(source, edits) };
}

export function hasProposedApiEntry(text: string, extensionId: string): boolean {
  const errors: ParseError[] = [];
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0 || parsed === null || typeof parsed !== 'object') {
    return false;
  }
  const existing = (parsed as Record<string, unknown>)['enable-proposed-api'];
  return Array.isArray(existing) && existing.includes(extensionId);
}

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Writes the entry, keeping a backup of the previous file next to it. */
export async function enableProposedApiInArgv(argvPath: string, extensionId: string, logger: Logger): Promise<'written' | 'already-enabled'> {
  let current = '';
  try {
    current = await fs.promises.readFile(argvPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const result = addProposedApiEntry(current, extensionId);
  if (!result.changed) {
    if (result.reason === 'already-enabled') {
      return 'already-enabled';
    }
    throw new Error(`${argvPath} is not valid JSON; fix it by hand (Preferences: Configure Runtime Arguments) and retry`);
  }
  await fs.promises.mkdir(path.dirname(argvPath), { recursive: true });
  if (current.length > 0) {
    const backup = `${argvPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.promises.writeFile(backup, current, 'utf8');
    logger.info(`Backed up ${argvPath} to ${backup}`);
  }
  const tmp = `${argvPath}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, result.text, 'utf8');
  await fs.promises.rename(tmp, argvPath);
  logger.info(`Added ${extensionId} to enable-proposed-api in ${argvPath}`);
  return 'written';
}

/** True when the error thrown by a proposed API call means the proposal is not enabled for us. */
export function isProposedApiDisabledError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /CANNOT use API proposal|proposed api|enabledApiProposals/i.test(message);
}

/**
 * Explains that the resolver API is not enabled and offers to register the extension in argv.json.
 * Returns true when the file was changed (a restart is then required).
 */
export async function promptToEnableProposedApi(
  context: vscode.ExtensionContext,
  dataFolderName: string,
  logger: Logger,
  force = false,
): Promise<boolean> {
  const argvPath = argvJsonPath(dataFolderName);
  let alreadyListed = false;
  try {
    alreadyListed = hasProposedApiEntry(await fs.promises.readFile(argvPath, 'utf8'), EXTENSION_ID);
  } catch {
    // no file yet
  }
  if (alreadyListed) {
    const restart = 'Restart to apply';
    const choice = await vscode.window.showInformationMessage(
      `WSL Remote is listed in ${path.basename(argvPath)} but the editor has not been restarted since. Quit the editor completely and start it again to connect to WSL.`,
      restart,
    );
    if (choice === restart) {
      await vscode.commands.executeCommand('workbench.action.quit');
    }
    return false;
  }
  if (!force && context.globalState.get<boolean>(DISMISSED_KEY)) {
    return false;
  }
  const write = 'Register and restart later';
  const manual = 'Open argv.json';
  const dismiss = "Don't ask again";
  const choice = await vscode.window.showWarningMessage(
    `WSL Remote needs the "resolvers" API, which ${vscode.env.appName} only grants to extensions listed under "enable-proposed-api" in ${argvPath}. Add "${EXTENSION_ID}" there now?`,
    { modal: true, detail: 'A backup of the file is kept next to it. The editor must be quit and started again afterwards; "Reload Window" is not enough.' },
    write,
    manual,
    dismiss,
  );
  if (choice === dismiss) {
    await context.globalState.update(DISMISSED_KEY, true);
    return false;
  }
  if (choice === manual) {
    await vscode.commands.executeCommand('workbench.action.configureRuntimeArguments');
    return false;
  }
  if (choice !== write) {
    return false;
  }
  try {
    const result = await enableProposedApiInArgv(argvPath, EXTENSION_ID, logger);
    const quit = 'Quit now';
    const picked = await vscode.window.showInformationMessage(
      result === 'written'
        ? `Added "${EXTENSION_ID}" to ${argvPath}. Quit ${vscode.env.appName} completely and start it again; then WSL connections work.`
        : `${argvPath} already lists "${EXTENSION_ID}". Quit ${vscode.env.appName} completely and start it again.`,
      quit,
    );
    if (picked === quit) {
      await vscode.commands.executeCommand('workbench.action.quit');
    }
    return result === 'written';
  } catch (error) {
    logger.error('Could not update argv.json', error);
    const open = 'Open argv.json';
    const picked = await vscode.window.showErrorMessage(`Could not update ${argvPath}: ${error instanceof Error ? error.message : String(error)}`, open);
    if (picked === open) {
      await vscode.commands.executeCommand('workbench.action.configureRuntimeArguments');
    }
    return false;
  }
}
