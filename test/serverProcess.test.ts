import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import type { Logger } from '../src/common/logger.js';
import type { ProductInfo } from '../src/common/productInfo.js';
import { ServerProcess, ServerStartError, type ServerStartOptions } from '../src/server/serverProcess.js';
import type { WslManager } from '../src/wsl/wslManager.js';

const logger = { trace() {}, debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

const product: ProductInfo = {
  nameShort: 'VSCodium',
  applicationName: 'codium',
  dataFolderName: '.vscode-oss',
  serverApplicationName: 'codium-server',
  serverDataFolderName: '.vscodium-server',
  commit: '0'.repeat(40),
  quality: 'stable',
  version: '1.135.06055',
  release: undefined,
  serverDownloadUrlTemplate: undefined,
};

/** A WslManager whose spawned "script" is driven by the test through `say` and `print`. */
function fakeWsl() {
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout,
    stderr: new PassThrough(),
    kill() {},
  });
  let env: Record<string, string> = {};
  const wsl = {
    spawnLinux(_distro: string, _command: string, _args: readonly string[], options: { env?: Record<string, string> }) {
      env = options.env ?? {};
      return child;
    },
  } as unknown as WslManager;
  return {
    wsl,
    env: () => env,
    say: (body: string) => stdout.write(`WR[${env.WR_ID}] ${body}\n`),
    print: (line: string) => stdout.write(`${line}\n`),
  };
}

function options(overrides: Partial<ServerStartOptions>): ServerStartOptions {
  return {
    distro: 'Ubuntu',
    product,
    downloadUrlTemplate: undefined,
    extensionIds: [],
    sourceEnvSetup: true,
    debug: false,
    startTimeoutMs: 100,
    lockTimeoutSeconds: 1,
    connectHost: 'auto',
    ...overrides,
  };
}

describe('ServerProcess.start', () => {
  it('passes the connect host to the script', async () => {
    const fake = fakeWsl();
    const started = ServerProcess.start(fake.wsl, logger, options({ connectHost: 'distroIp' }));
    assert.equal(fake.env().WR_CONNECT_HOST, 'distroIp');
    fake.print('Extension host agent listening on 4000');
    (await started).dispose();
  });
  it('times out after the start timeout', async () => {
    const fake = fakeWsl();
    await assert.rejects(ServerProcess.start(fake.wsl, logger, options({})), (error) => error instanceof ServerStartError && error.transient);
  });
  it('waits for the lock timeout on top of the start timeout while another window installs', async () => {
    const fake = fakeWsl();
    const started = ServerProcess.start(fake.wsl, logger, options({}));
    fake.say('lock=waiting owner=42');
    setTimeout(() => fake.print('Extension host agent listening on 4001'), 300);
    const server = await started;
    assert.equal(server.info.port, 4001);
    server.dispose();
  });
});
