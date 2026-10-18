import * as path from 'node:path';
import * as vscode from 'vscode';
import { confirmDeleteDistro, openEmptyWindow, openLocation, promptInstallDistro } from './commands.js';
import { DisposableStore } from './common/disposable.js';
import type { Logger } from './common/logger.js';
import type { RemoteLocationHistory } from './remoteLocationHistory.js';
import type { WslManager } from './wsl/wslManager.js';

export class DistroNode {
  constructor(
    readonly name: string,
    readonly isDefault: boolean,
    readonly state: string,
    readonly version: string,
    readonly locations: readonly string[],
  ) {}
}

export class LocationNode {
  constructor(
    readonly distro: string,
    readonly location: string,
  ) {}
}

type Node = DistroNode | LocationNode;

export const VIEW_ID = 'wslRemoteTargets';

/** The "WSL Targets" view in the Remote Explorer: distributions and their recent folders. */
export class DistroTreeDataProvider extends DisposableStore implements vscode.TreeDataProvider<Node> {
  private readonly changeEmitter = this.register(new vscode.EventEmitter<Node | undefined>());
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly wsl: WslManager,
    private readonly history: RemoteLocationHistory,
    private readonly logger: Logger,
  ) {
    super();
    const cmd = (id: string, handler: (...args: never[]) => unknown): void => {
      this.register(vscode.commands.registerCommand(id, handler as (...args: unknown[]) => unknown));
    };
    cmd('wsl-remote.explorer.refresh', () => this.refresh());
    cmd('wsl-remote.explorer.addDistro', async () => {
      await promptInstallDistro(wsl);
      this.refresh();
    });
    cmd('wsl-remote.explorer.openInCurrentWindow', (node: DistroNode) => openEmptyWindow(node.name, false));
    cmd('wsl-remote.explorer.openInNewWindow', (node: DistroNode) => openEmptyWindow(node.name, true));
    cmd('wsl-remote.explorer.openLocationInCurrentWindow', (node: LocationNode) => openLocation(node.distro, node.location, false));
    cmd('wsl-remote.explorer.openLocationInNewWindow', (node: LocationNode) => openLocation(node.distro, node.location, true));
    cmd('wsl-remote.explorer.removeLocation', async (node: LocationNode) => {
      await history.remove(node.distro, node.location);
      this.refresh();
    });
    cmd('wsl-remote.explorer.setDefaultDistro', async (node: DistroNode) => {
      await wsl.setDefaultDistro(node.name);
      this.refresh();
    });
    cmd('wsl-remote.explorer.deleteDistro', async (node: DistroNode) => {
      if (await confirmDeleteDistro(wsl, node.name)) {
        await history.forgetDistro(node.name);
        this.refresh();
      }
    });
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node instanceof LocationNode) {
      const isWorkspace = node.location.endsWith('.code-workspace');
      const item = new vscode.TreeItem(path.posix.basename(node.location) + (isWorkspace ? ' (Workspace)' : ''));
      item.description = path.posix.dirname(node.location);
      item.iconPath = new vscode.ThemeIcon(isWorkspace ? 'file-submodule' : 'folder');
      item.contextValue = 'wsl-remote.location';
      item.tooltip = node.location;
      item.command = { command: 'wsl-remote.explorer.openLocationInCurrentWindow', title: 'Open in Current Window', arguments: [node] };
      return item;
    }
    const item = new vscode.TreeItem(node.name, node.locations.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    item.description = [node.isDefault ? 'default' : undefined, node.state.toLowerCase()].filter(Boolean).join(', ');
    item.iconPath = new vscode.ThemeIcon('vm');
    item.contextValue = node.isDefault ? 'wsl-remote.distro.default' : 'wsl-remote.distro';
    item.tooltip = `${node.name} (WSL ${node.version}, ${node.state})`;
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      try {
        const distros = await this.wsl.listDistros();
        return distros.map((distro) => new DistroNode(distro.name, distro.isDefault, distro.state, distro.version, this.history.get(distro.name)));
      } catch (error) {
        this.logger.error('Could not list WSL distributions', error);
        return [];
      }
    }
    if (node instanceof DistroNode) {
      return node.locations.map((location) => new LocationNode(node.name, location));
    }
    return [];
  }
}
