# WSL Remote

Open any folder in the Windows Subsystem for Linux from VSCodium, or from any other VS Code build that does not ship Microsoft's Remote - WSL extension.

WSL Remote is an independent, MIT-licensed implementation. It is not affiliated with Microsoft or with the `jeanp413.open-remote-wsl` extension. Do not install it next to that extension or next to Microsoft's `ms-vscode-remote.remote-wsl`: each of them resolves `wsl+` windows, and two resolvers for the same authority conflict.

## What it does

- Opens folders and workspaces inside a WSL 2 distribution: Remote Explorer view, status bar menu, command palette, `Reopen Folder in WSL`.
- Downloads and starts the editor's own server (`codium-server` for VSCodium) inside the distribution. The archive is verified against the publisher's checksum when one is available, extracted atomically, and installations by several windows are serialized with a lock, so a crash or a second window never leaves a half-installed server behind.
- Runs one server per window as a child of the editor. When the window closes or the editor dies, the server stops; nothing stays behind in the distribution.
- Reconnects to the running server after a dropped connection instead of starting a new one.
- Forwards ports. When WSL does not forward `localhost` (NAT mode with `localhostForwarding=false`), the connection and the forwarded ports go to the distribution's IP address instead. For that the server listens on all interfaces in NAT mode (that address is only reachable from this computer) and on loopback in mirrored mode; the connection token protects it either way.
- Works on Alpine (`libstdc++` required), on distributions without `which` or with an unusual `PATH`, and with distribution names containing dots and dashes.
- **`server-env-setup` hook.** Before the server starts, `~/.vscodium-server/server-env-setup` (more precisely `~/<serverDataFolderName>/server-env-setup`) is sourced inside the distribution, exactly like Microsoft's extension does with `~/.vscode-server/server-env-setup`. Variables exported there reach the remote extension host and every terminal. This is the mechanism tools such as plan-swap use to give each editor its own `CODEX_HOME`.
- **Compatible server layout.** The server runs from `~/<serverDataFolderName>/bin/<commit>` with `--start-server`, and the launcher's pid is written to `~/<serverDataFolderName>/.<commit>.pid`, the same files Microsoft's and jeanp413's extensions use, so tools that locate or restart the server through them (plan-swap's automatic restart, for example) keep working.
- `wsl-remote.extensionHostEnv` sets environment variables on the remote extension host from the Windows side.

## Requirements

- Windows 10 21H1 or later, or Windows 11, with WSL 2.
- `wget` or `curl` and `tar` inside the distribution (every mainstream distribution has them).

## Installation

- From the registry: search for **WSL Remote** in the Extensions view, or run `codium --install-extension n2ns.wsl-remote`. VSCodium installs from [Open VSX](https://open-vsx.org/extension/n2ns/wsl-remote); editors configured for the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=n2ns.wsl-remote) find the same extension there.
- From a file: download `wsl-remote-<version>.vsix` from the [releases page](https://github.com/n2ns/wsl-remote/releases) and run `codium --install-extension wsl-remote-<version>.vsix`.

Then enable the resolver API as described in the next section.

## Enabling the resolver API

Connecting to a remote uses the `resolvers` API proposal. VSCodium grants it only to extensions listed under `enable-proposed-api` in `argv.json`. On first start WSL Remote detects that it is not listed and offers to add itself; the file is backed up first. The editor must then be quit completely and started again (`Reload Window` is not enough).

To do it by hand, run **Preferences: Configure Runtime Arguments** and add:

```jsonc
{
    "enable-proposed-api": ["n2ns.wsl-remote"]
}
```

## `codium` from a WSL shell

VSCodium's launcher looks for the WSL extension named in `VSCODE_WSL_EXTENSION_ID` (default `jeanp413.open-remote-wsl`). Export the variable in your shell profile inside the distribution:

```sh
export VSCODE_WSL_EXTENSION_ID=n2ns.wsl-remote
```

Afterwards `codium .` in a plain WSL shell opens the folder in a WSL window. Inside the integrated terminal of a WSL window `codium` already works without this.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `wsl-remote.serverDownloadUrlTemplate` | `""` | Overrides the server download URL. Placeholders: `${quality}`, `${version}`, `${commit}`, `${os}`, `${arch}`, `${release}`. Empty uses product.json, then VSCodium's GitHub releases. |
| `wsl-remote.connectHost` | `auto` | `auto`, `localhost` or `distroIp`. |
| `wsl-remote.serverEnvSetup` | `true` | Source `server-env-setup` before the server starts. |
| `wsl-remote.extensionHostEnv` | `{}` | Environment variables for the remote extension host; `null` removes one. |
| `wsl-remote.defaultExtensions` | `[]` | Extensions to install in the distribution on first start. |
| `wsl-remote.serverStartTimeout` | `180` | Seconds to wait for the server. |
| `wsl-remote.installLockTimeout` | `300` | Seconds to wait for another window's installation, added to the start timeout while waiting. |
| `wsl-remote.debug` | `false` | Trace the setup script. |

## Troubleshooting

- **WSL: Show Log** shows what the setup script did: environment hook found or not, download URL, checksum, networking mode, server port.
- Set `wsl-remote.debug` to `true` for a `set -x` trace of the setup script.
- A corrupted download is deleted automatically; reload the window to download again.
- If the window shows "No remote extension installed to resolve wsl", the `resolvers` proposal is not enabled yet; see above.

## Development

```sh
npm install
npm run check      # typecheck, lint, unit tests
npm run build      # dist/extension.js
npm run package    # wsl-remote-<version>.vsix
```

The unit tests run with Node's test runner and do not need the editor. Shell scripts are checked with `shellcheck -s sh`.

## License

MIT. See [LICENSE](LICENSE).
