#!/bin/bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PREFIX="$HOME/.local/lib/aqua-voice"
STAGE_ONLY=false
ACCEPT_SETUP=false
IMPORT_EXISTING=false
REPLACE_HANDLER=false
for option in "$@"; do
  case "$option" in
    --stage-only) STAGE_ONLY=true ;;
    --accept-setup) ACCEPT_SETUP=true ;;
    --import-existing) IMPORT_EXISTING=true ;;
    --replace-login-handler) REPLACE_HANDLER=true ;;
    *) echo "usage: ./install.sh [--accept-setup] [--import-existing] [--replace-login-handler] [--stage-only]" >&2; exit 2 ;;
  esac
done
if ! "$STAGE_ONLY" && ! "$ACCEPT_SETUP"; then
  echo "Setup installs the backend for your account, enables it at login, and registers Aqua login links if no other app handles them. Shortcuts and existing settings stay unchanged."
  echo "Optional: --import-existing copies previous settings/sign-in without changing the originals; --replace-login-handler replaces and backs up an existing handler."
  if [[ -t 0 ]]; then
    read -r -p "Install and enable? [y/N] " answer
    [[ "$answer" == y || "$answer" == Y ]] || exit 1
  else
    echo "Use --accept-setup after reviewing the setup description." >&2
    exit 1
  fi
fi
BIN_DIR="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
APPLICATION_DIR="$HOME/.local/share/applications"

if command -v bun >/dev/null; then
  BUN_EXECUTABLE=$(bun -p 'process.execPath')
elif command -v mise >/dev/null; then
  BUN_EXECUTABLE=$(mise which bun 2>/dev/null) || { echo "Install Bun with: mise use -g bun. Then click Set up Aqua Voice again." >&2; exit 1; }
else
  echo "Install Bun with: mise use -g bun. Then click Set up Aqua Voice again." >&2
  exit 1
fi
command -v cc >/dev/null || { echo "Install base-devel for the hotkey helper, then run setup again" >&2; exit 1; }
if ! "$STAGE_ONLY"; then
[[ -f "$HOME/.config/hypr/bindings.lua" ]] || { echo "This plugin requires Omarchy with Lua Hyprland bindings (~/.config/hypr/bindings.lua)." >&2; exit 1; }
for helper in jq wl-copy wtype pw-record hyprctl omarchy-shell systemctl; do
  command -v "$helper" >/dev/null || { echo "$helper is required" >&2; exit 1; }
done
for helper in secret-tool xdg-icon-resource xdg-mime xdg-open; do
  command -v "$helper" >/dev/null || { echo "$helper is required" >&2; exit 1; }
done
fi
mkdir -p "$PREFIX" "$BIN_DIR" "$UNIT_DIR" "$APPLICATION_DIR"
printf '#!/bin/bash\nexec %q "$@"\n' "$BUN_EXECUTABLE" > "$PREFIX/runtime"
chmod 0755 "$PREFIX/runtime"
install -m 0755 "$ROOT/bin/aqua-bridge.js" "$PREFIX/aqua-bridge"
install -m 0644 "$ROOT/bin/aqua-recovery.js" "$PREFIX/aqua-recovery.js"
install -m 0755 "$ROOT/bin/aqua-settings.js" "$PREFIX/aqua-settings.js"
install -m 0755 "$ROOT/bin/aqua-auth.js" "$PREFIX/aqua-auth.js"
install -m 0755 "$ROOT/bin/aqua-hotkey.js" "$PREFIX/aqua-hotkey.js"
cc -O2 -std=c11 -Wall -Wextra -Werror \
  "$ROOT/native/aqua-hotkey-capture.c" -o "$PREFIX/aqua-hotkey-capture"
install -m 0755 "$ROOT/bin/aqua-login-handler" "$PREFIX/aqua-login-handler"
install -m 0755 "$ROOT/bin/aqua-voice-control" "$BIN_DIR/aqua-voice-control"
install -m 0644 "$ROOT/aqua-voice.service" "$UNIT_DIR/aqua-voice.service"
install -m 0644 "$ROOT/aqua-voice.desktop" "$APPLICATION_DIR/aqua-voice.desktop"
install -m 0644 "$ROOT/aqua-voice-callback.desktop" "$APPLICATION_DIR/aqua-voice-callback.desktop"
if "$STAGE_ONLY"; then
  echo "Staged backend, controls, desktop entries, and service without activating them."
  exit 0
fi
xdg-icon-resource install --mode user --novendor --size 128 \
  "$ROOT/assets/aqua-orb.png" aqua-voice
if "$REPLACE_HANDLER"; then
  "$PREFIX/aqua-login-handler" claim --replace
else
  "$PREFIX/aqua-login-handler" claim
fi
command -v update-desktop-database >/dev/null && update-desktop-database "$APPLICATION_DIR"
systemctl --user daemon-reload
if "$IMPORT_EXISTING"; then
  "$PREFIX/runtime" "$PREFIX/aqua-auth.js" import-existing >/dev/null
fi
systemctl --user enable --now aqua-voice.service
readable_input=false
for device in /dev/input/event*; do
  if [[ -r "$device" ]]; then readable_input=true; break; fi
done
if ! "$readable_input"; then
  echo "Global shortcuts need read access to keyboard input devices. See README: Keyboard access. Panel dictation remains available." >&2
fi
touch "$PREFIX/.setup-complete"
echo "Open Aqua Voice → Account to sign in, then Settings → Record hotkey to choose a shortcut."

echo "Installed and started the Aqua Voice backend. It will start with the graphical session."
