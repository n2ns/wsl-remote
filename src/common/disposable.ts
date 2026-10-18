import type * as vscode from 'vscode';

/** Base class that owns a set of disposables and releases them in reverse order. */
export class DisposableStore implements vscode.Disposable {
  private readonly items: vscode.Disposable[] = [];
  private disposed = false;

  protected register<T extends vscode.Disposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
    } else {
      this.items.push(item);
    }
    return item;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const item of this.items.splice(0).reverse()) {
      try {
        item.dispose();
      } catch {
        // disposing must never throw
      }
    }
  }
}
