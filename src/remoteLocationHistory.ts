import * as vscode from 'vscode';
import { isValidDistroName } from './common/validate.js';
import { WSL_AUTHORITY_PREFIX } from './authResolver.js';

const STORAGE_KEY = 'wsl-remote.locationHistory.v1';
const MAX_PER_DISTRO = 20;

/** Recently opened folders and workspace files per distribution, shown in the Remote Explorer. */
export class RemoteLocationHistory {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get(distro: string): readonly string[] {
    return this.load()[distro] ?? [];
  }

  async add(distro: string, location: string): Promise<void> {
    const history = this.load();
    const list = (history[distro] ?? []).filter((item) => item !== location);
    list.unshift(location);
    history[distro] = list.slice(0, MAX_PER_DISTRO);
    await this.save(history);
  }

  async remove(distro: string, location: string): Promise<void> {
    const history = this.load();
    history[distro] = (history[distro] ?? []).filter((item) => item !== location);
    await this.save(history);
  }

  async forgetDistro(distro: string): Promise<void> {
    const history = this.load();
    delete history[distro];
    await this.save(history);
  }

  /** Read on every use: other windows update the same global state. */
  private load(): Record<string, string[]> {
    const stored = this.context.globalState.get<Record<string, string[]>>(STORAGE_KEY) ?? {};
    const history: Record<string, string[]> = {};
    for (const [distro, paths] of Object.entries(stored)) {
      if (isValidDistroName(distro) && Array.isArray(paths)) {
        history[distro] = paths.filter((p): p is string => typeof p === 'string');
      }
    }
    return history;
  }

  private save(history: Record<string, string[]>): Thenable<void> {
    return this.context.globalState.update(STORAGE_KEY, history);
  }
}

/** The distribution and path of the current window's workspace when it is a WSL remote. */
export function currentRemoteLocation(): { distro: string; path: string } | undefined {
  const candidate = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!candidate || candidate.scheme !== 'vscode-remote') {
    return undefined;
  }
  const separator = candidate.authority.indexOf('+');
  if (separator < 0 || candidate.authority.slice(0, separator) !== WSL_AUTHORITY_PREFIX) {
    return undefined;
  }
  const distro = candidate.authority.slice(separator + 1);
  if (!isValidDistroName(distro)) {
    return undefined;
  }
  return { distro, path: candidate.path };
}
