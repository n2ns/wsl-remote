import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  distroFromAuthority,
  validateDistroName,
  validateDownloadUrlTemplate,
  validateExtensionId,
  ValidationError,
} from '../src/common/validate.js';
import { windowsPathToWsl } from '../src/wsl/pathMapping.js';

describe('validateDistroName', () => {
  it('accepts the names wsl.exe produces', () => {
    for (const name of ['Ubuntu', 'Ubuntu-22.04', 'Ubuntu_26_Dev', 'docker-desktop', 'openSUSE-Tumbleweed', 'a']) {
      assert.equal(validateDistroName(name), name);
    }
  });
  it('rejects anything that could be shell or authority syntax', () => {
    for (const name of ['', ' Ubuntu', 'Ubuntu;rm -rf /', 'a+b', 'a b', '$(x)', '../x', '-leading', 'ü']) {
      assert.throws(() => validateDistroName(name), ValidationError, name);
    }
  });
});

describe('distroFromAuthority', () => {
  it('takes everything after the first plus', () => {
    assert.equal(distroFromAuthority('wsl+Ubuntu_26'), 'Ubuntu_26');
  });
  it('rejects other authorities and names with a second plus', () => {
    assert.throws(() => distroFromAuthority('ssh-remote+host'));
    assert.throws(() => distroFromAuthority('wsl+a+b'));
    assert.throws(() => distroFromAuthority('Ubuntu'));
  });
});

describe('validateDownloadUrlTemplate', () => {
  it('accepts the VSCodium template and the known placeholders', () => {
    const t = 'https://github.com/VSCodium/vscodium/releases/download/${version}/vscodium-reh-${os}-${arch}-${version}.tar.gz';
    assert.equal(validateDownloadUrlTemplate(t), t);
  });
  it('rejects http, spaces, quotes and unknown placeholders', () => {
    assert.throws(() => validateDownloadUrlTemplate('http://example.com/x'));
    assert.throws(() => validateDownloadUrlTemplate('https://example.com/x y'));
    assert.throws(() => validateDownloadUrlTemplate('https://example.com/$(id)'));
    assert.throws(() => validateDownloadUrlTemplate('https://example.com/${HOME}'));
    assert.throws(() => validateDownloadUrlTemplate("https://example.com/'"));
  });
});

describe('validateExtensionId', () => {
  it('accepts publisher.name', () => {
    assert.equal(validateExtensionId('n2ns.wsl-remote'), 'n2ns.wsl-remote');
  });
  it('rejects ids with spaces or shell characters', () => {
    assert.throws(() => validateExtensionId('a b.c'));
    assert.throws(() => validateExtensionId('noDot'));
    assert.throws(() => validateExtensionId('a.b;c'));
  });
});

describe('windowsPathToWsl', () => {
  it('maps drive letters to the automount root', () => {
    assert.equal(windowsPathToWsl('C:\\Users\\user\\proj'), '/mnt/c/Users/user/proj');
    assert.equal(windowsPathToWsl('d:\\_Dev\\wsl-remote\\'), '/mnt/d/_Dev/wsl-remote');
    assert.equal(windowsPathToWsl('D:\\'), '/mnt/d');
    assert.equal(windowsPathToWsl('D:/x/y'), '/mnt/d/x/y');
  });
  it('honours a custom automount root', () => {
    assert.equal(windowsPathToWsl('C:\\x', '/'), '/c/x');
    assert.equal(windowsPathToWsl('C:\\x', '/drives'), '/drives/c/x');
  });
  it('returns undefined for UNC and relative paths', () => {
    assert.equal(windowsPathToWsl('\\\\server\\share\\x'), undefined);
    assert.equal(windowsPathToWsl('relative\\path'), undefined);
  });
});
