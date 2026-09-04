#!/bin/bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PREFIX="${AQUA_VOICE_PREFIX:-$HOME/.local/lib/aqua-voice}"
BIN_DIR="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
APPLICATION_DIR="$HOME/.local/share/applications"

command -v bun >/dev/null || { echo "bun is required (install it with mise)" >&2; exit 1; }
command -v cc >/dev/null || { echo "a C compiler is required for hotkey capture" >&2; exit 1; }
for helper in jq wl-copy wtype; do
  command -v "$helper" >/dev/null || { echo "$helper is required" >&2; exit 1; }
done
for helper in secret-tool xdg-icon-resource xdg-mime xdg-open; do
  command -v "$helper" >/dev/null || { echo "$helper is required" >&2; exit 1; }
done
mkdir -p "$PREFIX" "$BIN_DIR" "$UNIT_DIR" "$APPLICATION_DIR"
install -m 0755 "$ROOT/bin/aqua-bridge.js" "$PREFIX/aqua-bridge"
install -m 0755 "$ROOT/bin/aqua-settings.js" "$PREFIX/aqua-settings.js"
install -m 0755 "$ROOT/bin/aqua-auth.js" "$PREFIX/aqua-auth.js"
install -m 0755 "$ROOT/bin/aqua-hotkey.js" "$PREFIX/aqua-hotkey.js"
cc -O2 -std=c11 -Wall -Wextra -Werror \
  "$ROOT/native/aqua-hotkey-capture.c" -o "$PREFIX/aqua-hotkey-capture"
install -m 0755 "$ROOT/bin/aqua-voice-control" "$BIN_DIR/aqua-voice-control"
install -m 0644 "$ROOT/aqua-voice.service" "$UNIT_DIR/aqua-voice.service"
install -m 0644 "$ROOT/aqua-voice.desktop" "$APPLICATION_DIR/aqua-voice.desktop"
install -m 0644 "$ROOT/aqua-voice-callback.desktop" "$APPLICATION_DIR/aqua-voice-callback.desktop"
xdg-icon-resource install --mode user --novendor --size 128 \
  "$ROOT/assets/aqua-orb.png" aqua-voice
xdg-mime default aqua-voice-callback.desktop x-scheme-handler/aquavoice
command -v update-desktop-database >/dev/null && update-desktop-database "$APPLICATION_DIR"
systemctl --user daemon-reload
systemctl --user enable --now aqua-voice.service
"$PREFIX/aqua-auth.js" migrate >/dev/null
"$PREFIX/aqua-hotkey.js" ensure >/dev/null

echo "Installed and started the Aqua Voice backend. It will start with the graphical session."
