# Aqua Voice 1.0.2 release checks

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

The client is unofficial. No claim of Aqua endorsement or universal Omarchy compatibility is made. The animated recording bars are decorative by user preference. Local history is not Aqua cloud history. Finalization recovery polls the original session after close code 4003; HTTP retranscription is limited to failures before stop_request. No new-WebSocket replay is used.

## Marketplace installation flow

The listing should use the standard repository install command:

```bash
omarchy plugin add https://github.com/Frank-III/omarchy-aqua-voice --enable
```

The marketplace supplies the card's **Copy install command** button; it is not a plugin UI control. After listing approval, verify that the button copies the correct repository URL and that a fresh installation shows **Set up Aqua Voice** in the Aqua bar panel. Identify the backend setup as a manual setup step in the submission notes. Setup runs only after the user clicks it and reports missing dependencies in the panel.

## Setup consent

First-run setup describes backend installation, login startup, and login-link registration before the user selects **Install and enable**. Existing-handler replacement is an initially unchecked choice, shown only when a conflicting handler is detected. Import is not part of the first-run screen. Terminal setup prints the same description and requires confirmation (or the explicit `--accept-setup` flag).

Settings are stored separately at `~/.config/aqua-voice/settings.json`. Import copies preferences without copying a plaintext token and does not alter the source; a token is validated and stored in the keyring only when import is selected. A prior login handler is preserved by default, backed up when replacement is selected, and can be restored with `aqua-voice-control restore-login-handler` without overriding a subsequent user choice.

Advanced users migrating a patched installation can run `bash install.sh --import-existing` from the plugin directory. The installer explains setup and asks for confirmation; import preserves the source and refuses to overwrite existing plugin preferences.
