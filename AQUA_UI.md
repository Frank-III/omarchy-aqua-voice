# Aqua desktop UI audit

Static inspection target: Aqua Voice macOS 0.19.8, extracted Electron renderer and settings schema.

## Portable features implemented in this plugin

- Dictation lifecycle: idle, double-tap armed, recording, processing, pasted/copied, error.
- Compact floating HUD, tray status, finish/cancel, paste-last, and focus-aware Hyprland paste.
- Language selection from Aqua's saved languages.
- Privacy Mode and Continual Learning, including their mutual exclusion.
- Refined/skip-LLM transcription and Casual Messaging. These fields are sent in Aqua's realtime `start` payload.
- Current model and realtime audio mode visibility.
- Bounded local transcript history with audio/finalization timing and clear-all.
- Aqua account, physical hotkey, backend, WebSocket, audio transport, and usage status.
- Account-synced Dictionary list with add and confirmed-remove actions.
- Browser sign-in, secure callback handling, keyring token storage, account status, and logout.
- One-shot global hotkey recording with XKB-aware modifier normalization and managed Hyprland binding rollback.
- Replacement and Custom Instruction counts/status without exposing their contents.

## Account-backed features still read-only

- Editing Replacements.
- Editing Custom Instructions.
- Cloud history search, ratings, and feedback.

The Mac renderer shows these features, but their local settings are not the whole source of truth. The plugin will not pretend an edit succeeded until the account synchronization endpoints are understood and tested.

## Intentionally omitted macOS-only features

- Dock visibility and app-window lifecycle.
- Native SystemBridge microphone/device switching.
- macOS screen recording for Deep Context.
- System-audio capture, camera translation, meeting prompts, Pins, and computer control.
- Native updater, onboarding, referral, subscription purchase, and permissions screens.

## Design reference

The control center follows the installed `io.github.lijiawei0305-pixel.mihomo` plugin: a fixed-size panel, persistent left navigation rail, one scrollable page on the right, native Omarchy controls, stable geometry across page changes, and numeric keyboard shortcuts.
