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
./install.sh

if [[ -d "$PLUGIN_DIR/.git" ]]; then
  git -C "$PLUGIN_DIR" remote set-url origin "file://$ROOT"
  omarchy plugin update frankmi.aqua-voice --yes
else
  omarchy plugin add "file://$ROOT" --enable
fi

systemctl --user restart aqua-voice.service
omarchy restart shell

sleep 1
aqua-voice-control status | jq -c \
  '{version,phase,hotkeyReady,tokenPresent,retryCount,error}'
