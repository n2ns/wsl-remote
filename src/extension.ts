import * as vscode from 'vscode';
import { WSL_AUTHORITY_PREFIX, WslAuthorityResolver } from './authResolver.js';
import { connectToDistro, reopenInWsl } from './commands.js';
import { Logger } from './common/logger.js';
import { getProductInfo } from './common/productInfo.js';
import { DistroTreeDataProvider, VIEW_ID } from './distroTreeView.js';
import { isProposedApiDisabledError, promptToEnableProposedApi } from './proposedApi.js';
import { currentRemoteLocation, RemoteLocationHistory } from './remoteLocationHistory.js';
import { WslManager } from './wsl/wslManager.js';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  if (process.platform !== 'win32') {
    return; // WSL only exists on Windows; the extension stays dormant on other hosts and in the web
  }
  const logger = new Logger('WSL Remote');
  context.subscriptions.push(logger);
  const wsl = new WslManager(logger);

  let product;
  try {
    product = await getProductInfo();
  } catch (error) {
    logger.error('Cannot read product.json; the extension cannot work in this build', error);
    void vscode.window.showErrorMessage(`WSL Remote cannot read ${vscode.env.appName}'s product.json: ${String(error)}`);
    return;
  }
  logger.info(`${vscode.env.appName} ${vscode.version} (${product.commit.slice(0, 10)}), server ${product.serverApplicationName} in ~/${product.serverDataFolderName}`);

  // The resolver API is a proposed API. Without it in argv.json, registering throws; everything
  // else still works so the user can fix the registration from inside the editor.
  let resolverRegistered = false;
  try {
    const resolver = new WslAuthorityResolver(wsl, logger);
    context.subscriptions.push(vscode.workspace.registerRemoteAuthorityResolver(WSL_AUTHORITY_PREFIX, resolver));
    context.subscriptions.push(resolver);
    resolverRegistered = true;
  } catch (error) {
    if (!isProposedApiDisabledError(error)) {
      throw error;
    }
    logger.warn(`The "resolvers" API proposal is not enabled for this extension: ${String(error)}`);
    void promptToEnableProposedApi(context, product.dataFolderName, logger);
  }
  await vscode.commands.executeCommand('setContext', 'wsl-remote.ready', resolverRegistered);

  const history = new RemoteLocationHistory(context);
  const location = currentRemoteLocation();
  if (location) {
    await history.add(location.distro, location.path);
  }

  const tree = new DistroTreeDataProvider(wsl, history, logger);
  context.subscriptions.push(tree);
  context.subscriptions.push(vscode.window.createTreeView(VIEW_ID, { treeDataProvider: tree }));

  const guard = (run: () => Promise<void> | void) => async (): Promise<void> => {
    if (!resolverRegistered) {
      await promptToEnableProposedApi(context, product.dataFolderName, logger, true);
      return;
    }
    try {
      await run();
    } catch (error) {
      logger.error('Command failed', error);
      void vscode.window.showErrorMessage(`WSL Remote: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('wsl-remote.connect', guard(() => connectToDistro(wsl, { useDefault: true, newWindow: false }))),
    vscode.commands.registerCommand('wsl-remote.connectInNewWindow', guard(() => connectToDistro(wsl, { useDefault: true, newWindow: true }))),
    vscode.commands.registerCommand('wsl-remote.connectUsingDistro', guard(() => connectToDistro(wsl, { useDefault: false, newWindow: false }))),
    vscode.commands.registerCommand('wsl-remote.connectUsingDistroInNewWindow', guard(() => connectToDistro(wsl, { useDefault: false, newWindow: true }))),
    vscode.commands.registerCommand('wsl-remote.reopenInWsl', guard(() => reopenInWsl(wsl, logger))),
    vscode.commands.registerCommand('wsl-remote.showLog', () => logger.show()),
    vscode.commands.registerCommand('wsl-remote.enableProposedApi', () => promptToEnableProposedApi(context, product.dataFolderName, logger, true)),
  );
}

export function deactivate(): void {
  // disposables registered in context.subscriptions stop the server
}
