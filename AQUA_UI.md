# Aqua desktop UI audit

Static inspection target: Aqua Voice macOS 0.19.8, extracted Electron renderer and settings schema.

## Portable features implemented in this plugin

- Dictation lifecycle: idle, double-tap armed, recording, processing, pasted/copied, error.
- Compact floating HUD, tray status, finish/cancel, paste-last, and focus-aware Hyprland paste.
- Searchable language selection using Aqua's recovered language enum; selected languages are saved locally.
- Privacy Mode and Continual Learning, including their mutual exclusion.
- Refined/skip-LLM transcription and Casual Messaging. These fields are sent in Aqua's realtime `start` payload.
- Current model and realtime audio mode visibility.
- Bounded local transcript history with audio/finalization timing and clear-all.
- Aqua account, physical hotkey, backend, WebSocket, audio transport, and usage status.
- Account-synced Dictionary list with add and confirmed-remove actions.
- Browser sign-in, secure callback handling, keyring token storage, account status, and logout.
- One-shot global hotkey recording with XKB-aware modifier normalization and managed Hyprland binding rollback.
- Account-backed replacement and writing-instruction editors, with visible failures and draft preservation.

## Account-backed features still read-only

- Cloud history search, ratings, and feedback.

Cloud history is not implemented. Local history is labeled explicitly.

## Personalization contracts verified against the extracted app

Source: `/home/frankmi/aqua-voice-linux/asar-extracted/.webpack/main/index.js` and the corresponding renderer bundle, version 0.19.8.

- `POST /users/transcript-customizations/` accepts `{operation:{type:"replacement_upsert",replacement:{from,to,preserveCase?,neverAddPunctuation?},oldFrom?}}` and `{operation:{type:"replacement_remove",from}}`.
- Writing instructions use `{customizations:{customInstructions:text}}`; an empty string clears them.
- The renderer defaults `preserveCase` to true when absent, and `neverAddPunctuation` to false.
- Server responses must contain a complete customization document before updating the local cache. Revisions prevent an older response from replacing a newer one.
- Tests cover operation shapes, authenticated HTTP request construction, language persistence, failed/malformed responses preserving local settings, and instruction clearing. An authenticated live GET succeeded; no test personalization was written to the real account.

## Status and interaction

- Errors from UI actions are shown; drafts clear only after successful saves.
- WebSocket state comes from the backend connection, account check timestamps are shown, and local word totals are calculated from local history.
- The user prefers the original decorative recording animation. It is retained as a recording indicator, not presented as an audio meter.

## Intentionally omitted macOS-only features

- Dock visibility and app-window lifecycle.
- Native SystemBridge microphone/device switching.
- macOS screen recording for Deep Context.
- System-audio capture, camera translation, meeting prompts, Pins, and computer control.
- Native updater, onboarding, referral, subscription purchase, and permissions screens.

## Design reference

The control center follows the installed `io.github.lijiawei0305-pixel.mihomo` plugin: a fixed-size panel, persistent left navigation rail, one scrollable page on the right, native Omarchy controls, stable geometry across page changes, and numeric keyboard shortcuts.
