import * as vscode from 'vscode';
import { isValidDistroName } from './common/validate.js';
import { WSL_AUTHORITY_PREFIX } from './authResolver.js';

const STORAGE_KEY = 'wsl-remote.locationHistory.v1';
const MAX_PER_DISTRO = 20;

/** Recently opened folders and workspace files per distribution, shown in the Remote Explorer. */
export class RemoteLocationHistory {
  private history: Record<string, string[]>;

  constructor(private readonly context: vscode.ExtensionContext) {
    const stored = context.globalState.get<Record<string, string[]>>(STORAGE_KEY) ?? {};
    this.history = {};
    for (const [distro, paths] of Object.entries(stored)) {
      if (isValidDistroName(distro) && Array.isArray(paths)) {
        this.history[distro] = paths.filter((p): p is string => typeof p === 'string');
      }
    }
  }

  get(distro: string): readonly string[] {
    return this.history[distro] ?? [];
  }

  async add(distro: string, location: string): Promise<void> {
    const list = (this.history[distro] ?? []).filter((item) => item !== location);
    list.unshift(location);
    this.history[distro] = list.slice(0, MAX_PER_DISTRO);
    await this.save();
  }

  async remove(distro: string, location: string): Promise<void> {
    this.history[distro] = (this.history[distro] ?? []).filter((item) => item !== location);
    await this.save();
  }

  async forgetDistro(distro: string): Promise<void> {
    delete this.history[distro];
    await this.save();
  }

  private save(): Thenable<void> {
    return this.context.globalState.update(STORAGE_KEY, this.history);
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
