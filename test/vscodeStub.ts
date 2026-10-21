// Minimal stand-in for the `vscode` module so pure functions in modules that import it can be
// unit-tested outside the editor. Anything touching the editor must not be called from tests.
export class EventEmitter<T> {
  private listeners: ((value: T) => void)[] = [];
  readonly event = (listener: (value: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };
  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
  dispose(): void {
    this.listeners = [];
  }
}
export const env = { appRoot: '', appName: 'stub' };
export const version = '0.0.0';
export const workspace = {
  getConfiguration: (): never => {
    throw new Error('vscode.workspace is not available in unit tests');
  },
};
export const window = {};
export const commands = {
  registerCommand: (): { dispose(): void } => ({ dispose: () => {} }),
};
export const Uri = {};
