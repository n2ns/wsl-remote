import * as vscode from 'vscode';
import type { Logger } from './common/logger.js';
import { getProductInfo } from './common/productInfo.js';
import { distroFromAuthority, ValidationError } from './common/validate.js';
import { getSettings } from './settings.js';
import { ServerProcess, ServerStartError } from './server/serverProcess.js';
import { canConnect, WslTunnel } from './server/tunnel.js';
import type { WslManager } from './wsl/wslManager.js';

export const WSL_AUTHORITY_PREFIX = 'wsl';

export function remoteAuthority(distro: string): string {
  return `${WSL_AUTHORITY_PREFIX}+${distro}`;
}

/**
 * Resolves `wsl+<distro>` authorities. One window has at most one server; when the connection
 * drops and the editor resolves again, the running server is reused so the reconnection token
 * stays valid. Only when the server is gone is a new one started.
 */
export class WslAuthorityResolver implements vscode.RemoteAuthorityResolver, vscode.Disposable {
  private server: ServerProcess | undefined;
  /** Host the editor must connect to: 127.0.0.1, or the distribution's address when localhost forwarding is off. */
  private connectHost = '127.0.0.1';
  private labelFormatter: vscode.Disposable | undefined;

  constructor(
    private readonly wsl: WslManager,
    private readonly logger: Logger,
  ) {}

  async resolve(authority: string, context: vscode.RemoteAuthorityResolverContext): Promise<vscode.ResolverResult> {
    const distro = distroFromAuthority(authority);
    this.logger.info(`Resolving ${authority} (attempt ${context.resolveAttempt})`);

    if (this.server && this.server.isRunning && this.server.distro === distro) {
      this.logger.info(`Reusing the running server on port ${this.server.info.port}`);
      return this.resolved(distro, this.server);
    }
    this.server?.dispose();
    this.server = undefined;

    const settings = getSettings();
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `WSL: ${distro}`, cancellable: false },
      async (progress) => {
        progress.report({ message: 'starting server' });
        try {
          const product = await getProductInfo();
          const server = await ServerProcess.start(this.wsl, this.logger, {
            distro,
            product,
            downloadUrlTemplate: settings.serverDownloadUrlTemplate,
            extensionIds: settings.defaultExtensions,
            sourceEnvSetup: settings.serverEnvSetup,
            debug: settings.debug,
            startTimeoutMs: settings.serverStartTimeoutSeconds * 1000,
            lockTimeoutSeconds: settings.installLockTimeoutSeconds,
            connectHost: settings.connectHost,
          });
          this.server = server;
          server.onDidExit(() => {
            if (this.server === server) {
              this.server = undefined;
            }
          });
          this.connectHost = await this.pickHost(server, settings.connectHost);
          this.logger.info(`Server for ${distro} is listening on port ${server.info.port}; connecting via ${this.connectHost}`);
          return this.resolved(distro, server);
        } catch (error) {
          this.logger.error(`Could not connect to ${distro}`, error);
          if (context.resolveAttempt === 1) {
            void this.offerRetry(distro, error);
          }
          const message = error instanceof Error ? error.message : String(error);
          if ((error instanceof ServerStartError && !error.transient) || error instanceof ValidationError) {
            throw vscode.RemoteAuthorityResolverError.NotAvailable(message, true);
          }
          throw vscode.RemoteAuthorityResolverError.TemporarilyNotAvailable(message);
        }
      },
    );
  }

  private resolved(distro: string, server: ServerProcess): vscode.ResolverResult {
    this.labelFormatter?.dispose();
    this.labelFormatter = vscode.workspace.registerResourceLabelFormatter({
      scheme: 'vscode-remote',
      authority: `${WSL_AUTHORITY_PREFIX}+*`,
      formatting: {
        label: '${path}',
        separator: '/',
        tildify: true,
        workspaceSuffix: `WSL: ${distro}`,
        workspaceTooltip: `Running in WSL distribution ${distro}`,
      },
    });
    const authority = new vscode.ResolvedAuthority(this.connectHost, server.info.port, server.info.connectionToken);
    const options: vscode.ResolvedOptions = {};
    const extensionHostEnv = getSettings().extensionHostEnv;
    if (Object.keys(extensionHostEnv).length > 0) {
      options.extensionHostEnv = extensionHostEnv;
    }
    return Object.assign(authority, options);
  }

  /** Decides how the editor reaches the server: localhost when WSL forwards ports, else the VM address. */
  private async pickHost(server: ServerProcess, preference: 'auto' | 'localhost' | 'distroIp'): Promise<string> {
    const ip = server.info.distroIp;
    if (preference === 'localhost') {
      return '127.0.0.1';
    }
    if (preference === 'distroIp') {
      if (!ip) {
        this.logger.warn('wsl-remote.connectHost is "distroIp" but the distribution reported no address; using localhost');
        return '127.0.0.1';
      }
      return ip;
    }
    if (await canConnect('127.0.0.1', server.info.port, 3000)) {
      return '127.0.0.1';
    }
    if (ip && (await canConnect(ip, server.info.port, 3000))) {
      this.logger.info(`localhost:${server.info.port} is not reachable (localhostForwarding off?); connecting to ${ip} instead`);
      return ip;
    }
    this.logger.warn(`Neither localhost nor ${ip ?? 'the distribution address'} answered on port ${server.info.port}; trying localhost`);
    return '127.0.0.1';
  }

  async tunnelFactory(tunnelOptions: vscode.TunnelOptions): Promise<vscode.Tunnel> {
    if (this.connectHost === '127.0.0.1') {
      return WslTunnel.passthrough(tunnelOptions.remoteAddress);
    }
    return WslTunnel.relay(tunnelOptions.remoteAddress, this.connectHost, tunnelOptions.localAddressPort ?? 0, this.logger);
  }

  private async offerRetry(distro: string, error: unknown): Promise<void> {
    const retry = 'Retry';
    const showLog = 'Show Log';
    const close = 'Close Remote';
    const detail = error instanceof Error ? error.message : String(error);
    const choice = await vscode.window.showErrorMessage(`Could not connect to WSL distribution "${distro}".`, { modal: true, detail }, retry, showLog, close);
    if (choice === retry) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } else if (choice === showLog) {
      this.logger.show();
    } else if (choice === close) {
      await vscode.commands.executeCommand('workbench.action.remote.close');
    }
  }

  dispose(): void {
    this.labelFormatter?.dispose();
    this.server?.dispose();
    this.server = undefined;
  }
}
