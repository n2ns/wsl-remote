import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type * as vscode from 'vscode';
import { RemoteLocationHistory } from '../src/remoteLocationHistory.js';

/** Two windows share the editor's global state. */
function sharedContext(): vscode.ExtensionContext {
  const store = new Map<string, unknown>();
  const globalState = {
    get: (key: string) => store.get(key),
    update: (key: string, value: unknown) => {
      store.set(key, structuredClone(value));
      return Promise.resolve();
    },
  };
  return { globalState } as unknown as vscode.ExtensionContext;
}

describe('RemoteLocationHistory', () => {
  it('keeps what another window added when removing an entry', async () => {
    const context = sharedContext();
    const windowA = new RemoteLocationHistory(context);
    await windowA.add('Ubuntu', '/home/a');
    const windowB = new RemoteLocationHistory(context);
    await windowB.add('Ubuntu', '/home/b');
    assert.deepEqual(windowA.get('Ubuntu'), ['/home/b', '/home/a']);
    await windowA.remove('Ubuntu', '/home/a');
    assert.deepEqual(windowB.get('Ubuntu'), ['/home/b']);
  });
});
