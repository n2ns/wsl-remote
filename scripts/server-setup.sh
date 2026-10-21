#!/bin/sh
# WSL Remote: installs (if needed) and runs the editor server inside the distribution.
#
# The extension streams this file to `sh` through stdin and keeps stdin open for as long as the
# window is connected. Everything the script needs arrives as environment variables (forwarded by
# WSLENV), so no value is ever interpolated into a command line:
#
#   WR_ID              marker id, echoed in every status line
#   WR_COMMIT          server commit (40 hex chars)
#   WR_QUALITY         stable | insider
#   WR_VERSION         editor version, e.g. 1.135.06055
#   WR_RELEASE         VSCodium release suffix, may be empty
#   WR_SERVER_APP      server launcher name, e.g. codium-server
#   WR_DATA_DIR        server data folder name under $HOME, e.g. .vscodium-server
#   WR_URL_TEMPLATE    download URL with ${quality} ${version} ${commit} ${os} ${arch} ${release}
#   WR_TOKEN           connection token for this server
#   WR_EXTENSIONS      space separated extension ids to pre-install (may be empty)
#   WR_ENV_SETUP       1 = source $HOME/$WR_DATA_DIR/server-env-setup before anything else
#   WR_DEBUG           1 = trace the script
#   WR_LOCK_TIMEOUT    seconds to wait for another window's installation (default 300)
#   WR_CONNECT_HOST    auto | localhost | distroIp: how the editor reaches the server (default auto)
#
# Status lines have the form `WR[<id>] key=value` and are the only lines the extension parses,
# besides the server's own "Extension host agent listening on <port>".

say() { printf 'WR[%s] %s\n' "$WR_ID" "$*"; }
fail() { say "error=$1"; exit 1; }

[ "${WR_DEBUG:-0}" = 1 ] && set -x
[ -n "$WR_ID" ] || { echo "WR_ID is not set" >&2; exit 2; }
for v in WR_COMMIT WR_QUALITY WR_VERSION WR_SERVER_APP WR_DATA_DIR WR_URL_TEMPLATE WR_TOKEN; do
  eval "val=\${$v}"
  [ -n "$val" ] || fail "missing variable $v"
done
case "$WR_COMMIT" in *[!0-9a-f]*) fail "commit is not a hex hash";; esac
case "$WR_DATA_DIR" in */*|.|..) fail "data dir must be a plain folder name";; esac
case "$WR_SERVER_APP" in */*) fail "server app must be a plain file name";; esac

DATA_DIR="$HOME/$WR_DATA_DIR"
BIN_DIR="$DATA_DIR/bin"
SERVER_DIR="$BIN_DIR/$WR_COMMIT"
SERVER_SCRIPT="$SERVER_DIR/bin/$WR_SERVER_APP"
ENV_SETUP="$DATA_DIR/server-env-setup"

say "distro=${WSL_DISTRO_NAME:-unknown} kernel=$(uname -r 2>/dev/null) user=$(id -un 2>/dev/null)"
NETWORKING=
if [ -x /usr/bin/wslinfo ]; then
  NETWORKING="$(/usr/bin/wslinfo --networking-mode 2>/dev/null)"
  say "networking=$NETWORKING"
fi

# ---- environment hook (same file name and timing as Microsoft's Remote - WSL) ----------------
if [ "${WR_ENV_SETUP:-1}" = 1 ]; then
  if [ -f "$ENV_SETUP" ]; then
    say "envSetup=found path=$ENV_SETUP"
    # shellcheck disable=SC1090
    . "$ENV_SETUP"
  else
    say "envSetup=absent path=$ENV_SETUP"
  fi
else
  say "envSetup=disabled"
fi

# ---- platform ---------------------------------------------------------------------------------
if ! command -v uname >/dev/null 2>&1; then
  fail "uname not found; cannot detect platform (NixOS: add coreutils to the profile)"
fi
PLATFORM="$(uname -s)"
[ "$PLATFORM" = Linux ] || fail "unsupported platform $PLATFORM"
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  armv7l|armv8l) ARCH=armhf ;;
  *) fail "unsupported architecture $(uname -m)" ;;
esac
if [ -f /etc/alpine-release ]; then
  OS=alpine
  if command -v apk >/dev/null 2>&1 && ! apk info 2>/dev/null | grep -qx 'libstdc++'; then
    fail "libstdc++ is required on Alpine: run 'apk add libstdc++ bash' and retry"
  fi
else
  OS=linux
fi
say "os=$OS arch=$ARCH"

# ---- installation ------------------------------------------------------------------------------
install_server() {
  mkdir -p "$BIN_DIR" || fail "cannot create $BIN_DIR"
  LOCK_DIR="$BIN_DIR/.install-$WR_COMMIT.lock"
  waited=0
  timeout="${WR_LOCK_TIMEOUT:-300}"
  while ! mkdir "$LOCK_DIR" 2>/dev/null; do
    # Another window is installing the same commit. Wait for it, unless its owner is gone.
    owner="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      say "lock=stale owner=$owner"
      rm -rf "$LOCK_DIR"
      continue
    fi
    if [ -x "$SERVER_SCRIPT" ]; then
      return 0
    fi
    [ "$waited" -lt "$timeout" ] || fail "timed out waiting for another installation of $WR_COMMIT"
    [ "$waited" -eq 0 ] && say "lock=waiting owner=${owner:-unknown}"
    sleep 1
    waited=$((waited + 1))
  done
  echo $$ > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
  if [ -x "$SERVER_SCRIPT" ]; then
    say "install=skipped reason=already-present"
    rm -rf "$LOCK_DIR"; trap - EXIT
    return 0
  fi

  url="$WR_URL_TEMPLATE"
  url="$(printf '%s' "$url" | sed -e "s|\${quality}|$WR_QUALITY|g" -e "s|\${version}|$WR_VERSION|g" \
        -e "s|\${commit}|$WR_COMMIT|g" -e "s|\${os}|$OS|g" -e "s|\${arch}|$ARCH|g" -e "s|\${release}|$WR_RELEASE|g")"
  say "download=start url=$url"
  tarball="$BIN_DIR/$WR_COMMIT-$$.tar.gz"
  tmpdir="$BIN_DIR/$WR_COMMIT-$$.tmp"
  rm -rf "$tarball" "$tmpdir"
  if command -v wget >/dev/null 2>&1; then
    wget --tries=3 --timeout=20 --no-verbose -O "$tarball" "$url" || { rm -f "$tarball"; fail "download failed (wget) url=$url"; }
  elif command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --connect-timeout 20 --silent --show-error --output "$tarball" "$url" || { rm -f "$tarball"; fail "download failed (curl) url=$url"; }
  else
    fail "neither wget nor curl is installed in the distribution"
  fi
  [ -s "$tarball" ] || { rm -f "$tarball"; fail "downloaded file is empty url=$url"; }

  # Verify against the publisher's checksum when one is published next to the archive.
  if command -v sha256sum >/dev/null 2>&1; then
    sum_file="$tarball.sha256"
    if command -v wget >/dev/null 2>&1; then
      wget --tries=2 --timeout=20 --quiet -O "$sum_file" "$url.sha256" 2>/dev/null || rm -f "$sum_file"
    else
      curl --fail --location --silent --output "$sum_file" "$url.sha256" 2>/dev/null || rm -f "$sum_file"
    fi
    if [ -s "$sum_file" ]; then
      expected="$(awk '{print $1}' "$sum_file" | head -n 1)"
      actual="$(sha256sum "$tarball" | awk '{print $1}')"
      rm -f "$sum_file"
      if [ "$expected" != "$actual" ]; then
        rm -f "$tarball"
        fail "checksum mismatch expected=$expected actual=$actual"
      fi
      say "checksum=verified"
    else
      say "checksum=unavailable"
    fi
  fi

  if ! tar -tzf "$tarball" >/dev/null 2>&1; then
    rm -f "$tarball"
    fail "downloaded archive is not a valid tar.gz (removed; reload to download again)"
  fi
  mkdir -p "$tmpdir" || fail "cannot create $tmpdir"
  say "extract=start"
  if ! tar -xzf "$tarball" -C "$tmpdir" --strip-components 1; then
    rm -rf "$tarball" "$tmpdir"
    fail "extraction failed"
  fi
  rm -f "$tarball"
  if [ ! -f "$tmpdir/bin/$WR_SERVER_APP" ] || [ ! -f "$tmpdir/node" ]; then
    rm -rf "$tmpdir"
    fail "archive does not contain bin/$WR_SERVER_APP and node (wrong download URL template?)"
  fi
  if [ -f "$tmpdir/bin/helpers/check-requirements.sh" ]; then
    sh "$tmpdir/bin/helpers/check-requirements.sh"
    rc=$?
    if [ "$rc" -eq 99 ]; then
      rm -rf "$tmpdir"
      fail "this distribution does not meet the server's requirements (glibc/libstdc++ too old)"
    fi
  fi
  # mv into an existing directory would nest the new server inside it; a complete one is kept, a partial one
  # (an interrupted installation of another extension with the same layout) is replaced. We hold the lock.
  if [ -x "$SERVER_SCRIPT" ]; then
    rm -rf "$tmpdir"
    say "install=skipped reason=already-present"
    rm -rf "$LOCK_DIR"; trap - EXIT
    return 0
  fi
  [ -e "$SERVER_DIR" ] && { rm -rf "$SERVER_DIR" || fail "cannot remove incomplete $SERVER_DIR"; }
  if ! mv "$tmpdir" "$SERVER_DIR" 2>/dev/null; then
    # Lost a race we could not see (lock dir removed by hand); keep whatever is there if it is complete.
    if [ -x "$SERVER_SCRIPT" ]; then
      rm -rf "$tmpdir"
    else
      rm -rf "$tmpdir"
      fail "cannot move extracted server into place at $SERVER_DIR"
    fi
  fi
  say "install=done dir=$SERVER_DIR"
  rm -rf "$LOCK_DIR"; trap - EXIT
}

if [ -x "$SERVER_SCRIPT" ]; then
  say "install=present dir=$SERVER_DIR"
else
  install_server
fi
[ -x "$SERVER_SCRIPT" ] || fail "server launcher missing at $SERVER_SCRIPT"

# Old servers of this editor are kept by Microsoft's extension too; we only remove our own leftovers.
find "$BIN_DIR" -maxdepth 1 \( -name '*-*.tmp' -o -name '*-*.tar.gz' \) -mmin +120 -exec rm -rf {} + 2>/dev/null

# ---- connection token --------------------------------------------------------------------------
TOKEN_FILE="$DATA_DIR/.wsl-remote-$WR_COMMIT-$$.token"
# umask only for the token: the server inherits this shell's umask for the files the user creates.
(umask 077 && printf '%s' "$WR_TOKEN" > "$TOKEN_FILE") || fail "cannot write $TOKEN_FILE"
find "$DATA_DIR" -maxdepth 1 -name '.wsl-remote-*.token' -mmin +1440 -delete 2>/dev/null

# ---- start ---------------------------------------------------------------------------------------
ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "ip=${ip:-}"
# The editor connects to the distribution's address when WSL does not forward localhost, which only reaches a
# server listening on all interfaces. In NAT mode that address is private to this computer; in mirrored mode
# (and WSL 1) all interfaces are the host's own, so the server stays on loopback there unless asked otherwise.
case "${WR_CONNECT_HOST:-auto}" in
  localhost) LISTEN_HOST=127.0.0.1 ;;
  distroIp) LISTEN_HOST=0.0.0.0 ;;
  *)
    case "$NETWORKING:$(uname -r)" in
      nat:*) LISTEN_HOST=0.0.0.0 ;;
      :*-microsoft-standard*) LISTEN_HOST=0.0.0.0 ;; # WSL 2 before wslinfo existed only had NAT
      *) LISTEN_HOST=127.0.0.1 ;;
    esac
    ;;
esac
say "listen=$LISTEN_HOST"

# --start-server: without it, --install-extension would turn the run into a one-shot CLI call.
set -- --start-server --host="$LISTEN_HOST" --port=0 --connection-token-file "$TOKEN_FILE" \
  --telemetry-level off --use-host-proxy --accept-server-license-terms
for ext in $WR_EXTENSIONS; do
  set -- "$@" --install-extension "$ext"
done
say "start=server pid=$$"
# The launcher (bin/<app>-server) runs node without exec, so a signal to the launcher alone would leave the node
# server and its pty host behind. With setsid the launcher heads its own process group and the whole group is
# stopped at once; without setsid (not expected on a supported distribution) only the launcher is signaled.
if command -v setsid >/dev/null 2>&1; then HAVE_SETSID=1; else HAVE_SETSID=0; say "warn=setsid not found"; fi
# stdin stays with this script: it is the keep-alive channel, the server must not read from it.
if [ "$HAVE_SETSID" = 1 ]; then
  setsid "$SERVER_SCRIPT" "$@" </dev/null 2>&1 &
else
  "$SERVER_SCRIPT" "$@" </dev/null 2>&1 &
fi
SERVER_PID=$!
stop_server() {
  [ "$HAVE_SETSID" = 1 ] && kill -- "-$SERVER_PID" 2>/dev/null
  kill "$SERVER_PID" 2>/dev/null
  # Give the group a moment to go away, so nothing of it outlives this script.
  i=0
  while [ "$i" -lt 25 ] && kill -0 "-$SERVER_PID" 2>/dev/null; do sleep 0.2; i=$((i + 1)); done
}
# Same pid file as the other WSL extensions write (<data dir>/.<commit>.pid, the launcher's pid, i.e. the
# parent of the node server process), so tools that locate the server through it keep working.
PID_FILE="$DATA_DIR/.$WR_COMMIT.pid"
echo "$SERVER_PID" > "$PID_FILE" || say "warn=cannot write $PID_FILE"

# shellcheck disable=SC2329,SC2317  # invoked through the traps below
cleanup() {
  stop_server
  rm -f "$TOKEN_FILE"
  # Only our own entry: a newer server of the same commit may have replaced it meanwhile.
  [ "$(cat "$PID_FILE" 2>/dev/null)" = "$SERVER_PID" ] && rm -f "$PID_FILE"
}
trap 'cleanup; exit 0' INT TERM HUP
trap 'cleanup' EXIT

# The window closed or the extension host went away: stdin reaches end of file, so stop the server.
# A background command gets /dev/null as stdin in POSIX sh, hence the explicit copy on fd 3.
exec 3<&0
( while IFS= read -r _line; do :; done; stop_server ) <&3 &
WATCHER_PID=$!

wait "$SERVER_PID"
rc=$?
kill "$WATCHER_PID" 2>/dev/null
say "exit=server code=$rc"
exit "$rc"
