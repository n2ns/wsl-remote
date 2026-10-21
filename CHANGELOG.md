# Changelog

## Unreleased

- The fallback to the distribution's IP address now works: the server listens on all interfaces when the editor may connect through that address (`connectHost` `distroIp`, or `auto` in NAT mode) and stays on loopback in mirrored mode.
- An incomplete server directory left by an interrupted installation is replaced instead of failing every connection.
- The server and its terminals keep the distribution's umask; only the token file is written with `077`.
- The setup script no longer leaves a copy of itself in `/tmp` on every connection.
- Waiting for another window's installation extends the start timeout by `installLockTimeout`.
- Invalid settings (download URL template, extension ids) fail the connection instead of being retried.
- A custom automount root containing `x`, `2` or `7` is mapped correctly by `Reopen Folder in WSL`.
- Recent folders added by another window are no longer overwritten.
- The Remote Explorer shows the registration prompt while the `resolvers` proposal is not enabled.
- Stopping the server waits for its whole process group on `dash`.

## 0.0.1 (2026-10-18)

Initial release.

- Connect to WSL 2 distributions from VSCodium and other VS Code builds: Remote Explorer view with recent folders, status bar menu, command palette, `Reopen Folder in WSL`.
- Server installation with checksum verification, atomic extraction and cross-window locking; one server per window, stopped with the window; reconnection reuses the running server.
- `server-env-setup` hook sourced before the server starts; `wsl-remote.extensionHostEnv` setting.
- The server launcher runs in its own process group (`setsid`) and the whole group is stopped when the window closes, so neither the node server nor its pty host outlives the connection.
- Server started with `--start-server` (so pre-installed extensions do not turn the run into a one-shot CLI call) and the launcher pid written to `~/<serverDataFolderName>/.<commit>.pid`, matching the layout other WSL extensions and tools such as plan-swap rely on.
- Automatic fallback to the distribution's IP address with a port relay when localhost forwarding is unavailable.
- Self-service registration in `argv.json` (`enable-proposed-api`).
- Alpine support; no dependency on `which`; distribution names validated everywhere.
