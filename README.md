# Aqua Voice for Omarchy

An Omarchy-native Aqua Voice client. It uses a plain JavaScript/Bun backend for Aqua's realtime WebSocket protocol, physical input, Wayland paste, and state IPC. No Electron process runs; the QML plugin owns the visible tray, panel, and HUD.

The bar widget uses Aqua Voice's official orb asset from `https://aquavoice.com/images/icons/orb-128.png`.

## Screenshots

Settings and shortcut controls:

![Aqua Voice settings panel](preview.png)

The compact recording overlay stays visible without taking focus:

![Aqua Voice recording overlay on the Omarchy desktop](assets/recording-overlay.png)

## Interaction

- Choose a shortcut in **Settings → Record hotkey**. Double-tap it to start hands-free recording, then tap once to finish and paste. The legacy fallback is `Super+Shift+F23`; most keyboards need a recorded shortcut.
- A single early tap only arms the gesture; it does not open the microphone or WebSocket.
- A slow second tap re-arms instead of recording, key repeats are ignored, and Escape or input-device loss cancels without paste.
- Open the Omarchy bar panel to see Idle, Recording, Processing, or Error state.
- A bottom-center, click-through HUD stays visible for Recording and Transcribing without taking focus. Its animated bars and pulsing orb are recording indicators, not microphone level meters.
- The panel can start, finish, or cancel a dictation and shows the latest completed transcript.
- Right-click the bar icon to paste the last completed dictation.
- System controls in the panel show the microphone, account, physical hotkey, protocol, and backend state and can start or stop the backend.
- The panel reports audio length and post-release latency for the latest result.
- The tray panel follows Mihomo's fixed two-column Omarchy layout with Dictate, History, Dictionary, Account, Settings, and System pages.
- History keeps at most 20 completed dictations in `~/.local/state/aqua-voice/history.json` (mode `0600`); each entry can be copied or pasted into the currently focused window, Privacy Mode prevents new entries, and the page can clear all entries.
- The Settings page offers a searchable picker for the languages in Aqua's recovered schema and controls Privacy Mode, Continual Learning, transcript refinement, and Casual Messaging without launching Electron.
- The Dictionary page manages account-synced words, replacements (including case and punctuation options), and writing instructions. Saves use the customization operations recovered from Aqua macOS 0.19.8; failures remain visible and retain your draft.
- Account opens Aqua's official browser sign-in, receives its `aquavoice://token=…` callback, validates the account, and stores the token in Secret Service instead of plaintext settings.
- Captures shorter than 100 ms are discarded as accidental taps.
- Fast finalizations that disconnect before returning text are retried once from an in-memory PCM buffer; the buffer is cleared after completion or failure.
- Final annotated text preserves whitespace and excludes deleted segments. Empty final results finish immediately with “No text returned”.
- Each completed WebSocket session reports delivered text with `stop.content`, then waits for the server to close (with a five-second cleanup timeout). Copy-only or failed paste reports empty content; cancellation reports `canceled: true`. Once final delivery begins, duplicate finals and disconnects cannot trigger another automatic insertion.
- Stopping capture waits for both recorder exit and the audio-reader drain before flushing the final partial chunk and sending `stop_request`.
- Paste waits for the configured shortcut's physical release events before injecting `Ctrl+V` or Omarchy's tagged-terminal `Shift+Insert`, preventing the stop chord from leaking into SSH/TUI applications.
- The release guard includes physical Alt for keymaps using `altwin:swap_alt_win`; standard Alt/Super layouts are supported too.
- Settings can record a new global shortcut with a one-shot C helper. The helper exits after one chord, JavaScript applies XKB remaps, and the generated Hyprland binding swallows the chord before the backend handles double-tap/start/stop.
- Transcript clipboard operations use native Wayland `wl-copy`. They do not use HEX/GPUI's X11 image-clipboard fallback, so an unreachable X11 server cannot block text history copy or paste.
- Paste never changes compositor focus. It snapshots the focused Hyprland client before clipboard setup and injects only if that same client is still focused; otherwise the transcript remains copied without a synthetic keypress.

The interaction model follows the useful parts of [HEX](https://github.com/anomalyco/hex): explicit recording/processing feedback, short-tap rejection, cancellation that never pastes, and direct read-only evdev hotkey monitoring independent of the settings frontend. This grants the backend visibility into all physical keyboard events; it does not retain ordinary key state and reacts to the configured shortcut plus Escape. Aqua remains the transcription provider, using a Secret Service login token, with migration support for legacy `~/.config/Aqua Voice/settings.json` tokens.

## Install

Requires Omarchy's plugin-capable shell and Lua Hyprland configuration (`~/.config/hypr/bindings.lua`), PipeWire, a working Secret Service keyring, and an Aqua Voice account. This is an unofficial client using a reverse-engineered service protocol; upstream changes can require an update.

Install Bun with `mise use -g bun`, and ensure these Arch packages are available: `base-devel`, `jq`, `wl-clipboard`, `wtype`, `pipewire-audio`, `libsecret`, and `xdg-utils`. The installer checks the commands it needs before modifying files. The Bun runtime path is pinned at installation; rerun the installer if that Bun version is removed.

```bash
omarchy plugin add https://github.com/Frank-III/omarchy-aqua-voice --enable
cd ~/.config/omarchy/plugins/frankmi.aqua-voice
./install.sh
```

Adding the plugin installs its panel; the separate installer sets up its backend, login callback, and App Finder entry. Open **Aqua Voice → Account** to sign in, then **Settings → Record hotkey**. Existing shortcuts and settings are preserved by installation. Start/finish buttons also work without a global shortcut.

### Keyboard access

Global shortcuts and shortcut recording need read access to `/dev/input/event*` keyboard devices. If unavailable, the panel remains usable and System shows the shortcut as unavailable. Grant access according to your system policy. Membership in the `input` group is one option, but it grants access to other keyboard input too; it is not added automatically. After changing group membership, log out and back in.

### Updates and removal

After `omarchy plugin update frankmi.aqua-voice`, rerun the installed plugin's `./install.sh`, then `systemctl --user restart aqua-voice.service` while not dictating. Updating only the plugin does not update the backend copy.

To remove the plugin, stop and disable `aqua-voice.service`, then use `omarchy plugin remove frankmi.aqua-voice`. Backend files remain in `~/.local/lib/aqua-voice`, the control script in `~/.local/bin`, and desktop entries in `~/.local/share/applications`. Local history, settings, and credentials remain until explicitly removed; use Account → Sign out first if you want to remove the saved keyring credential.

## Runtime

```bash
aqua-voice-control status
aqua-voice-control trigger start
aqua-voice-control trigger stop
aqua-voice-control trigger cancel
aqua-voice-control auth status
aqua-voice-control auth login
aqua-voice-control hotkey status
aqua-voice-control record-hotkey
journalctl --user -u aqua-voice.service -f
```

The backend is `aqua-voice.service`. Audio exists only while a capture or one automatic finalization retry is active and is cleared after completion, failure, or cancellation. Completed text may be kept in the bounded local history unless Privacy Mode is enabled; no audio is written to disk.

The installer enables and starts the user service under `graphical-session.target`. It therefore starts automatically after every reboot when the Omarchy graphical session begins, once Hyprland, PipeWire, and the Wayland session are available.

The installer also registers a visible XDG application named **Aqua Voice**. Searching Aqua, voice, dictation, transcription, speech, or microphone in Omarchy's app finder opens the existing QML control center; it does not start Electron or create another backend process.

## Development

```bash
bun test
omarchy plugin validate .
```

After pulling or committing an update, deploy and verify the local backend and Omarchy plugin with:

```bash
./update.sh
```

The updater refuses dirty source or destination checkouts, runs tests and validation, fast-forwards a separate installed checkout without changing its origin, installs the backend, and restarts the service and shell. It also works directly from the installed plugin checkout. Run it while not dictating.

To audit a newly extracted Aqua desktop release before using it as a protocol reference:

```bash
bun scripts/check-aqua-compat.js ~/aqua-voice-linux/app
```

The checker fails if Aqua changes any realtime, finalization, dictionary, profile, sign-in, or callback anchor used by this plugin.

## Hotkey capture

Choose **Settings → Record hotkey**, then press one chord. Escape cancels and a 15-second timeout leaves the existing shortcut untouched. The 17 KB C helper runs only during capture and emits one JSON chord; it never remains resident or records ordinary typing. JavaScript translates XKB remaps, backs up `~/.config/hypr/bindings.lua` once, updates the managed Aqua binding, validates `hyprctl configerrors`, rolls back on failure, and restarts the backend with the new matcher.

This is an unofficial interoperability project and is not affiliated with Aqua Voice.
