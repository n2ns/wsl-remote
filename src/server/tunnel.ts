import * as net from 'node:net';
import * as vscode from 'vscode';
import type { Logger } from '../common/logger.js';

/**
 * A forwarded port. When the distribution is reachable through localhost (mirrored networking, or
 * NAT with localhostForwarding) the remote port is already available locally and nothing needs to
 * run. Otherwise a small TCP relay listens on 127.0.0.1 and connects to the distribution's address.
 */
export class WslTunnel implements vscode.Tunnel {
  private readonly onDidDisposeEmitter = new vscode.EventEmitter<void>();
  readonly onDidDispose = this.onDidDisposeEmitter.event;
  readonly remoteAddress: { port: number; host: string };
  readonly localAddress: { port: number; host: string };
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();

  private constructor(remoteAddress: { port: number; host: string }, localAddress: { port: number; host: string }) {
    this.remoteAddress = remoteAddress;
    this.localAddress = localAddress;
  }

  /** The remote port is reachable at localhost: report it as forwarded without opening anything. */
  static passthrough(remoteAddress: { port: number; host: string }): WslTunnel {
    return new WslTunnel(remoteAddress, { host: 'localhost', port: remoteAddress.port });
  }

  /** Relays 127.0.0.1:<localPort> to <targetHost>:<remotePort>. localPort 0 picks a free port. */
  static async relay(
    remoteAddress: { port: number; host: string },
    targetHost: string,
    localPort: number,
    logger: Logger,
  ): Promise<WslTunnel> {
    const tunnel = new WslTunnel(remoteAddress, { host: 'localhost', port: localPort });
    const server = net.createServer((socket) => {
      const upstream = net.connect(remoteAddress.port, targetHost);
      tunnel.sockets.add(socket);
      tunnel.sockets.add(upstream);
      const close = (): void => {
        socket.destroy();
        upstream.destroy();
        tunnel.sockets.delete(socket);
        tunnel.sockets.delete(upstream);
      };
      socket.on('error', close);
      upstream.on('error', (error) => {
        logger.debug(`Port relay ${localPort} -> ${targetHost}:${remoteAddress.port} failed: ${error.message}`);
        close();
      });
      socket.on('close', close);
      upstream.on('close', close);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(localPort, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address && typeof address === 'object') {
      tunnel.localAddress.port = address.port;
    }
    tunnel.server = server;
    logger.info(`Forwarding localhost:${tunnel.localAddress.port} -> ${targetHost}:${remoteAddress.port}`);
    return tunnel;
  }

  dispose(): void {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    this.server?.close();
    this.server = undefined;
    this.onDidDisposeEmitter.fire();
    this.onDidDisposeEmitter.dispose();
  }
}

/** Checks whether something accepts TCP connections at host:port within `timeoutMs`. */
export function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}
