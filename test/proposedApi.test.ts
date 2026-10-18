import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addProposedApiEntry, argvJsonPath, hasProposedApiEntry, isProposedApiDisabledError } from '../src/proposedApi.js';
import { parseProductInfo } from '../src/common/productInfo.js';

const ID = 'n2ns.wsl-remote';

describe('addProposedApiEntry', () => {
  it('creates the list in an empty or missing file', () => {
    const result = addProposedApiEntry('', ID);
    assert.equal(result.changed, true);
    assert.ok(hasProposedApiEntry(result.text, ID));
  });
  it('appends to an existing list and keeps comments and other keys', () => {
    const text = '// This configuration file allows you to pass permanent command line arguments\n{\n\t"enable-crash-reporter": true,\n\t"crash-reporter-id": "abc",\n\t"enable-proposed-api": [\n\t\t"jeanp413.open-remote-wsl"\n\t]\n}\n';
    const result = addProposedApiEntry(text, ID);
    assert.equal(result.changed, true);
    assert.ok(result.text.startsWith('// This configuration'));
    assert.ok(result.text.includes('"crash-reporter-id": "abc"'));
    assert.ok(hasProposedApiEntry(result.text, 'jeanp413.open-remote-wsl'));
    assert.ok(hasProposedApiEntry(result.text, ID));
  });
  it('is idempotent', () => {
    const once = addProposedApiEntry('{}', ID);
    assert.equal(once.changed, true);
    const twice = addProposedApiEntry(once.text, ID);
    assert.equal(twice.changed, false);
    if (!twice.changed) assert.equal(twice.reason, 'already-enabled');
  });
  it('refuses to rewrite a file it cannot parse', () => {
    const result = addProposedApiEntry('{ "enable-proposed-api": [ , ', ID);
    assert.equal(result.changed, false);
    if (!result.changed) assert.equal(result.reason, 'invalid-json');
  });
  it('tolerates a trailing comma', () => {
    const result = addProposedApiEntry('{\n  "enable-crash-reporter": false,\n}\n', ID);
    assert.equal(result.changed, true);
    assert.ok(hasProposedApiEntry(result.text, ID));
  });
});

describe('argvJsonPath', () => {
  it('uses the product data folder in the home directory', () => {
    assert.equal(argvJsonPath('.vscode-oss', {}, 'C:\\Users\\me'), 'C:\\Users\\me\\.vscode-oss\\argv.json');
  });
  it('uses the portable directory when VSCODE_PORTABLE is set', () => {
    assert.equal(argvJsonPath('.vscode-oss', { VSCODE_PORTABLE: 'D:\\portable\\data' }, 'C:\\Users\\me'), 'D:\\portable\\data\\argv.json');
  });
});

describe('isProposedApiDisabledError', () => {
  it('recognizes the editor\'s message', () => {
    assert.ok(isProposedApiDisabledError(new Error("Extension 'n2ns.wsl-remote' CANNOT use API proposal: resolvers.")));
    assert.ok(!isProposedApiDisabledError(new Error('ENOENT')));
  });
});

describe('parseProductInfo', () => {
  it('reads the VSCodium fields', () => {
    const info = parseProductInfo({
      nameShort: 'VSCodium', applicationName: 'codium', dataFolderName: '.vscode-oss', serverApplicationName: 'codium-server',
      serverDataFolderName: '.vscodium-server', commit: '1a46a584725d5dd330e0bcd7f5510f24990efcf2', quality: 'stable', release: null,
      serverDownloadUrlTemplate: 'https://github.com/VSCodium/vscodium/releases/download/1.135.06055/vscodium-reh-${os}-${arch}-1.135.06055.tar.gz',
    }, '1.135.06055');
    assert.equal(info.version, '1.135.06055');
    assert.equal(info.release, undefined);
    assert.equal(info.serverDataFolderName, '.vscodium-server');
  });
  it('rejects a malformed commit', () => {
    assert.throws(() => parseProductInfo({ applicationName: 'x', dataFolderName: '.x', serverApplicationName: 'x-server', serverDataFolderName: '.x-server', commit: 'nope', quality: 'stable' }, '1.0.0'));
  });
});
