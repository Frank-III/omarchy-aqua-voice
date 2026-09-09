# Aqua Voice 1.0.1 release checks

## Automated coverage

Run `bun test`, `bash -n install.sh update.sh bin/aqua-voice-control`, `omarchy plugin validate .`, and `git diff --check`.

Tests include a clean staged installation in an isolated home directory, compilation of the hotkey helper, desktop controls with Bun absent from PATH, default settings and realtime model, manifest/backend version agreement, final-delivery lifecycle, cancellation, exact transcript extraction, and personalization failure persistence. `install.sh --stage-only` installs files without starting services or changing the desktop; it is for packaging/tests, not normal interactive installation.

## Verified on the development Omarchy machine

- Dictation logs show final text and paste dispatches to ChatGPT and Ghostty.
- App Finder opens the QML panel and connects to the installed backend.
- Existing keyring login was freshly validated against the live profile API. The official desktop sign-in URL redirects to the working provider-login page; the user completed a fresh provider sign-in/callback round trip and confirmed it works. Isolated tests cover callback success, rejected/malformed profiles, keyring failures, browser-launch failure, sign-out, and restart failure.
- Account customization GET succeeds. Personalization POST shapes are recovered from Aqua macOS 0.19.8 and exercised with mocked responses, not changes to a real user's account.
- Existing user shortcut and settings remain intact.

## Still required for broader release confidence

- A different user's clean Omarchy login: install, browser sign-in/callback, keyring persistence across logout/login, record shortcut, and dictate into an editor and terminal.
- Add/edit/remove one chosen replacement and save/clear chosen writing instructions against that test account, verifying the resulting dictation.
- Check keyboard-access denial and granting access in that user's environment.
- Ask Aqua to confirm delivered outcomes for normal, empty, canceled, and recovered sessions. A successful paste shortcut cannot prove how much text the destination actually accepted.

The client is unofficial. No claim of Aqua endorsement or universal Omarchy compatibility is made. The animated recording bars are decorative by user preference. Local history is not Aqua cloud history. New-WebSocket retry is implemented; HTTP recovery is not.
