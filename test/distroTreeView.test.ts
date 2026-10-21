import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Logger } from '../src/common/logger.js';
import { DistroTreeDataProvider } from '../src/distroTreeView.js';
import type { RemoteLocationHistory } from '../src/remoteLocationHistory.js';
import type { WslManager } from '../src/wsl/wslManager.js';

const wsl = { listDistros: () => Promise.resolve([{ name: 'Ubuntu', isDefault: true, state: 'Running', version: '2' }]) } as unknown as WslManager;
const history = { get: () => [] } as unknown as RemoteLocationHistory;
const logger = {} as Logger;

describe('DistroTreeDataProvider', () => {
  it('lists distributions once the resolver is registered', async () => {
    assert.equal((await new DistroTreeDataProvider(wsl, history, logger, true).getChildren()).length, 1);
  });
  it('stays empty without the resolver, so the view shows the registration prompt', async () => {
    assert.deepEqual(await new DistroTreeDataProvider(wsl, history, logger, false).getChildren(), []);
  });
});
