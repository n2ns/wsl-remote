#!/usr/bin/env sh
# WSL Remote: makes `codium <path>` typed in a plain WSL shell open that path in a WSL window.
#
# VSCodium's own bin/codium script runs this file when it detects WSL:
#   wslCode.sh COMMIT QUALITY ELECTRON APP_NAME SERVERDATAFOLDER VERSION [args...]
# It finds the file through the extension id in $VSCODE_WSL_EXTENSION_ID (default
# jeanp413.open-remote-wsl), so for this extension the shell needs
#   export VSCODE_WSL_EXTENSION_ID=n2ns.wsl-remote
# The "Install `codium` command for WSL shells" command adds that line to ~/.profile.
#
# The server of the current editor version must already be installed in this distribution; the
# extension installs it on the first connection. This script does not download anything itself.
COMMIT=$1
QUALITY=$2
WIN_CODE_CMD=$3
APP_NAME=$4
DATAFOLDER=$5
VERSION=$6
shift 6
[ "$VSCODE_WSL_DEBUG_INFO" = true ] && set -x

: "$QUALITY" "$VERSION"
[ -n "$DATAFOLDER" ] || DATAFOLDER=".vscodium-server"

REMOTE_CLI="$HOME/$DATAFOLDER/bin/$COMMIT/bin/remote-cli/$APP_NAME"
if [ ! -x "$REMOTE_CLI" ]; then
  echo "WSL Remote: the server for this editor version is not installed in this distribution yet." >&2
  echo "Connect once from the editor (Remote Explorer > WSL Targets), then run $APP_NAME again." >&2
  exit 1
fi

if [ -n "$WSL_DISTRO_NAME" ]; then
  AUTHORITY="wsl+$WSL_DISTRO_NAME"
else
  echo "WSL Remote: WSL_DISTRO_NAME is not set; this WSL version is too old." >&2
  exit 5
fi

# Pass stdin through a file when `-` is among the arguments (e.g. `git diff | codium -`).
PIPE_INPUT_FILE=
if [ ! -t 0 ]; then
  for arg in "$@"; do
    if [ "$arg" = "-" ]; then
      PIPE_INPUT_FILE=$(mktemp /tmp/wsl-remote-stdin-XXXXXX)
      cat > "$PIPE_INPUT_FILE"
      break
    fi
  done
fi

STORED_ENV=$(mktemp /tmp/wsl-remote-env-XXXXXX)
env --null > "$STORED_ENV"

VSCODE_CLIENT_COMMAND="$WIN_CODE_CMD" \
VSCODE_CLIENT_COMMAND_CWD="$(dirname "$0")" \
VSCODE_CLI_AUTHORITY="$AUTHORITY" \
VSCODE_CLI_REMOTE_ENV="$STORED_ENV" \
VSCODE_STDIN_FILE_PATH="$PIPE_INPUT_FILE" \
WSLENV="VSCODE_CLI_REMOTE_ENV/w:$WSLENV" \
"$REMOTE_CLI" "$@"
