import * as vscode from 'vscode';
import { remoteAuthority } from './authResolver.js';
import type { Logger } from './common/logger.js';
import { validateDistroName } from './common/validate.js';
import { windowsPathToWsl } from './wsl/pathMapping.js';
import { WSL_EXE, type WslDistro, type WslManager } from './wsl/wslManager.js';

export async function pickDistro(wsl: WslManager, placeHolder: string): Promise<WslDistro | undefined> {
  const distros = await wsl.listDistros();
  if (distros.length === 0) {
    const install = 'Install a distribution';
    const choice = await vscode.window.showInformationMessage('No WSL distribution is installed.', install);
    if (choice === install) {
      await promptInstallDistro(wsl);
    }
    return undefined;
  }
  interface DistroItem extends vscode.QuickPickItem {
    distro: WslDistro;
  }
  const items: DistroItem[] = distros.map((distro) => {
    const item: DistroItem = { label: distro.name, detail: `${distro.state}, WSL ${distro.version}`, distro };
    if (distro.isDefault) {
      item.description = 'default';
    }
    return item;
  });
  const picked = await vscode.window.showQuickPick(items, { placeHolder, matchOnDescription: true });
  return picked?.distro;
}

export async function connectToDistro(wsl: WslManager, options: { useDefault: boolean; newWindow: boolean }): Promise<void> {
  let name: string | undefined;
  if (options.useDefault) {
    const distros = await wsl.listDistros();
    name = (distros.find((distro) => distro.isDefault) ?? distros[0])?.name;
    if (!name) {
      name = (await pickDistro(wsl, 'Select the WSL distribution to connect to'))?.name;
    }
  } else {
    name = (await pickDistro(wsl, 'Select the WSL distribution to connect to'))?.name;
  }
  if (name) {
    openEmptyWindow(name, options.newWindow);
  }
}

export function openEmptyWindow(distro: string, newWindow: boolean): void {
  validateDistroName(distro);
  void vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: remoteAuthority(distro), reuseWindow: !newWindow });
}

export function openLocation(distro: string, location: string, newWindow: boolean): void {
  validateDistroName(distro);
  const uri = vscode.Uri.from({ scheme: 'vscode-remote', authority: remoteAuthority(distro), path: location });
  if (location.endsWith('.code-workspace')) {
    void vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow });
  } else {
    void vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow });
  }
}

/**
 * Reopens the folder or workspace of a local window inside a distribution, mapping the Windows
 * path to the distribution's mount (`C:\x` -> `/mnt/c/x`, or wherever /etc/wsl.conf mounts drives).
 */
export async function reopenInWsl(wsl: WslManager, logger: Logger): Promise<void> {
  const target = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!target || target.scheme !== 'file') {
    void vscode.window.showInformationMessage('Open a local folder or workspace first; it will be reopened inside WSL.');
    return;
  }
  const distro = await pickDistro(wsl, 'Reopen the current folder in which WSL distribution?');
  if (!distro) {
    return;
  }
  const mountRoot = await detectMountRoot(wsl, distro.name, logger);
  const mapped = windowsPathToWsl(target.fsPath, mountRoot);
  if (!mapped) {
    void vscode.window.showErrorMessage(`The path ${target.fsPath} is not on a drive WSL can mount (UNC paths are not supported).`);
    return;
  }
  openLocation(distro.name, mapped, false);
}

async function detectMountRoot(wsl: WslManager, distro: string, logger: Logger): Promise<string> {
  try {
    const result = await wsl.exec(distro, 'sh', ['-c', 'r=$(sed -n "s/^[[:space:]]*root[[:space:]]*=[[:space:]]*//p" /etc/wsl.conf 2>/dev/null | tail -n 1 | tr -d "\\"\\047 "); printf "%s" "${r:-/mnt/}"']);
    const root = result.stdout.trim();
    if (result.exitCode === 0 && root.startsWith('/')) {
      return root.endsWith('/') ? root : `${root}/`;
    }
  } catch (error) {
    logger.debug(`Could not read the automount root of ${distro}: ${String(error)}`);
  }
  return '/mnt/';
}

/** Installs a new distribution in a terminal, so the user sees wsl.exe's progress and prompts. */
export async function promptInstallDistro(wsl: WslManager): Promise<void> {
  const [online, local] = await Promise.all([wsl.listOnlineDistros(), wsl.listDistros().catch(() => [])]);
  const installed = new Set(local.map((distro) => distro.name));
  const items = online
    .filter((distro) => !installed.has(distro.name))
    .map((distro) => ({ label: distro.friendlyName, description: distro.name, distro }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select the distribution to install', matchOnDescription: true });
  if (!picked) {
    return;
  }
  validateDistroName(picked.distro.name);
  const terminal = vscode.window.createTerminal({
    name: `Install ${picked.label}`,
    shellPath: WSL_EXE,
    shellArgs: ['--install', '--distribution', picked.distro.name],
  });
  terminal.show();
}

export async function confirmDeleteDistro(wsl: WslManager, distro: string): Promise<boolean> {
  validateDistroName(distro);
  const remove = 'Unregister';
  const choice = await vscode.window.showWarningMessage(
    `Unregister the WSL distribution "${distro}"?`,
    { modal: true, detail: 'All files inside the distribution are deleted permanently. This cannot be undone.' },
    remove,
  );
  if (choice !== remove) {
    return false;
  }
  await wsl.unregisterDistro(distro);
  return true;
}
