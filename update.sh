#!/bin/bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_DIR="$HOME/.config/omarchy/plugins/frankmi.aqua-voice"

cd "$ROOT"

if [[ -n $(git status --porcelain) ]]; then
  echo "Refusing to update from a dirty repository. Commit or stash the changes first." >&2
  exit 1
fi

command -v bun >/dev/null || { echo "bun is required (install it with mise)" >&2; exit 1; }
command -v omarchy >/dev/null || { echo "omarchy is required" >&2; exit 1; }

bun test
omarchy plugin validate .

if [[ "$(realpath "$ROOT")" != "$(realpath -m "$PLUGIN_DIR")" ]]; then
  if [[ -d "$PLUGIN_DIR/.git" ]]; then
    if [[ -n $(git -C "$PLUGIN_DIR" status --porcelain) ]]; then
      echo "Installed plugin has local changes; preserve or commit them before updating." >&2
      exit 1
    fi
    # Import this checked-out commit without replacing the public origin URL.
    git -C "$PLUGIN_DIR" fetch "$ROOT" HEAD
    git -C "$PLUGIN_DIR" merge --ff-only FETCH_HEAD
  else
    omarchy plugin add "$(git remote get-url origin)" --enable
  fi
fi

./install.sh
systemctl --user restart aqua-voice.service
omarchy restart shell

sleep 1
aqua-voice-control status | jq -c \
  '{version,phase,hotkeyReady,tokenPresent,retryCount,error}'
