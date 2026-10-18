/**
 * Maps a Windows path to its location inside a distribution. WSL mounts each drive letter under
 * the automount root (`/mnt/` unless /etc/wsl.conf says otherwise) using the lower-case letter.
 * UNC paths (`\\server\share`) are not mounted automatically and map to nothing.
 */
export function windowsPathToWsl(windowsPath: string, mountRoot = '/mnt/'): string | undefined {
  const match = /^([A-Za-z]):[\\/]?(.*)$/.exec(windowsPath.trim());
  if (!match) {
    return undefined;
  }
  const drive = (match[1] ?? '').toLowerCase();
  const rest = (match[2] ?? '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  const root = mountRoot.endsWith('/') ? mountRoot : `${mountRoot}/`;
  return rest.length > 0 ? `${root}${drive}/${rest}` : `${root}${drive}`;
}
