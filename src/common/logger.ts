import * as vscode from 'vscode';

/**
 * Thin wrapper over a VS Code LogOutputChannel. The channel keeps the user-selected log level,
 * so trace output only shows when the user raises the level for this channel.
 */
export class Logger implements vscode.Disposable {
  private readonly channel: vscode.LogOutputChannel;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name, { log: true });
  }

  trace(message: string, ...args: unknown[]): void {
    this.channel.trace(message, ...args);
  }

  debug(message: string, ...args: unknown[]): void {
    this.channel.debug(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.channel.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.channel.warn(message, ...args);
  }

  error(message: string, error?: unknown): void {
    if (error === undefined) {
      this.channel.error(message);
    } else {
      this.channel.error(`${message}: ${describeError(error)}`);
    }
  }

  show(): void {
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
