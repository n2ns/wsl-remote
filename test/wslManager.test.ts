import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildEnvironment, decodeWslOutput, parseListOnline, parseListVerbose } from '../src/wsl/wslManager.js';

const utf16 = (text: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);

describe('decodeWslOutput', () => {
  it('decodes UTF-16LE management output and strips the BOM', () => {
    assert.equal(decodeWslOutput(utf16('  NAME\r\n* Ubuntu\r\n')), '  NAME\r\n* Ubuntu\r\n');
  });
  it('leaves UTF-8 interop output alone', () => {
    assert.equal(decodeWslOutput(Buffer.from('héllo\n', 'utf8')), 'héllo\n');
  });
  it('handles empty output', () => {
    assert.equal(decodeWslOutput(Buffer.alloc(0)), '');
  });
});

describe('parseListVerbose', () => {
  it('parses the English table with a default marker', () => {
    const out = '  NAME            STATE           VERSION\r\n* Ubuntu_26       Running         2\r\n  Ubuntu_26_Dev   Stopped         2\r\n';
    assert.deepEqual(parseListVerbose(out), [
      { name: 'Ubuntu_26', isDefault: true, state: 'Running', version: '2' },
      { name: 'Ubuntu_26_Dev', isDefault: false, state: 'Stopped', version: '2' },
    ]);
  });
  it('ignores localized headers and blank lines', () => {
    // A zh-CN header (name / state / version), written as escapes so the file stays ASCII
  const out = '  \u540d\u79f0            \u72b6\u6001            \u7248\u672c\r\n\r\n* Debian          Stopped         2\r\n  docker-desktop  Running         2\r\n';
    assert.deepEqual(parseListVerbose(out).map((d) => d.name), ['Debian', 'docker-desktop']);
  });
  it('skips rows whose name would not be a valid distribution name', () => {
    const out = '* Ubuntu;x        Running         2\r\n  Ok-1            Stopped         1\r\n';
    assert.deepEqual(parseListVerbose(out).map((d) => d.name), ['Ok-1']);
  });
  it('returns an empty list for no rows', () => {
    assert.deepEqual(parseListVerbose(''), []);
  });
});

describe('parseListOnline', () => {
  it('parses the online catalogue', () => {
    const out = 'The following is a list of valid distributions that can be installed.\r\nInstall using \'wsl.exe --install <Distro>\'.\r\n\r\nNAME                            FRIENDLY NAME\r\nUbuntu                          Ubuntu\r\nDebian                          Debian GNU/Linux\r\nkali-linux                      Kali Linux Rolling\r\n';
    assert.deepEqual(parseListOnline(out), [
      { name: 'Ubuntu', friendlyName: 'Ubuntu' },
      { name: 'Debian', friendlyName: 'Debian GNU/Linux' },
      { name: 'kali-linux', friendlyName: 'Kali Linux Rolling' },
    ]);
  });
});

describe('buildEnvironment', () => {
  it('forwards the given variables through WSLENV and keeps an existing list', () => {
    const previous = process.env['WSLENV'];
    process.env['WSLENV'] = 'FOO/u';
    try {
      const env = buildEnvironment({ env: { WR_ID: 'abc', WR_PATH: 'C:\\x' }, forwardFlags: { WR_PATH: '/p' } });
      assert.equal(env['WR_ID'], 'abc');
      assert.equal(env['WSLENV'], 'WR_ID:WR_PATH/p:FOO/u');
    } finally {
      if (previous === undefined) delete process.env['WSLENV'];
      else process.env['WSLENV'] = previous;
    }
  });
  it('rejects variable names that are not POSIX identifiers', () => {
    assert.throws(() => buildEnvironment({ env: { 'BAD NAME': 'x' } }));
  });
});
