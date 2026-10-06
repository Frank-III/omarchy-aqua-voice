# Aqua Voice 1.0.4 release checks

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

## 1.0.3 authentication regression checks

- WebSocket URL contains no credential; Authorization header has the bearer token. Saved-login header auth reached `ready` in a live no-audio check; invalid-token header auth was rejected.
- Desktop callback has no URI-bearing Exec argument and activates over D-Bus. The isolated GIO launch test verifies callback delivery and process arguments.
- Stage installation compiles both native helpers and installs the D-Bus service. Existing plugin-owned callback registration is upgraded; unrelated handlers remain opt-in.
- Before resubmission, perform browser sign-in with the new D-Bus callback and check the browser/portal path as well as the helper. The old submission was closed; use a new submission linking the credential remediation evidence.

**Live portal handoff verified:** setup now reloads D-Bus activation and migrates only this plugin's stale portal handler entries. The installed portal → callback → API validation → keyring → backend restart path completed using the existing login. The desktop entry has no Exec fallback. Current Chromium's direct portal path is supported; generic xdg-open callback launch is not. A fresh provider sign-in remains a manual UI smoke test, distinct from the successful live credential handoff.

## 1.0.4 compatibility and capture

Retired memory/prompt-set fields are no longer sent. Settings exposes a PipeWire source picker that affects only Aqua. Microphone discovery runs once at backend startup and on explicit refresh, not on the status polling interval. A selected source that produces no audio fails with a clear error.

Connection readiness has a single 10-second budget. Stopping early waits only for the remainder; readiness triggers queued-audio delivery before stop_request. An unavailable connection does not cut off an ongoing recording; retained audio is recovered when the user finishes. No new WebSocket replay is introduced. Timings for first audio, socket-open, ready, and stop_request are logged without credentials or transcript content. These changes require live microphone and delayed-connection smoke testing in addition to the isolated tests.
