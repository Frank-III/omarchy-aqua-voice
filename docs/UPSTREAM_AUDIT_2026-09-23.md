# Aqua upstream audit — 2026-09-23

## Evidence

- Official stable updater: https://updates.aquavoice.com/stable/darwin/arm64/RELEASES.json
- Feed reports 0.20.0, published 2026-09-22T22:08:38.373Z.
- Artifact: https://updates.aquavoice.com/stable/darwin/Aqua%20Voice-darwin-0.20.0.zip
- Extracted package.json and Info.plist both report 0.20.0.
- Extracted app.asar SHA-256: `168370ccadd08f56bb5e47db28b9fc107c52891073c5278fb97ad902329997a7` (local integrity identifier, not a vendor signature).
- Compared `.webpack/main/index.js` and `.webpack/renderer/main_window/index.js` with the retained 0.19.8 extraction.
- The public changelog retrieved during this audit ended at 0.18.6, so it is not the authority for the current shipped version. The general macOS DMG URL had an older modification date than the updater ZIP.

## Relevant findings

- 0.20.0 removes `streamingModel` from settings and `streaming_model` from the realtime start payload. The plugin should stop transmitting stale overrides. No claim is made that the server currently rejects them.
- The desktop finalization formula is `15000 + 1000 * floor(audioSeconds / 60)`. Our existing implementation rounded up a continuous increment; the prepared patch matches upstream exactly.
- The default remains `AvalonV11` in the shipped settings schema. A marketing changelog mention of Avalon 1.5 does not justify inventing a new wire model ID.
- PCM16/16kHz, stop_request, annotated document updates, set_session_id, session-recovery, retranscription, recovery outcome reporting, close code 4003, personalization HEAD revision checks, replacement operations, and browser sign-in/callback anchors remain present.
- The desktop default for native audio changes from false to true. Our PipeWire capture does not use the macOS native bridge, so that is not a Linux setting to copy.
- Static anchor matching cannot establish behavioral compatibility. The checker now labels that limit and checks the recovery/personalization anchors as well.

## Proposed plugin release: 1.0.3

Local changes prepare the independent plugin patch version, omit the retired streaming-model field, align finalization timing, and cover the previously applied keyring lookup timeout with a regression test. The pre-existing read-only HUD diagnostic remains present. This audit does not install or publish a release, alter user preferences, or establish that the intermittent connection-readiness issue is fixed.

## Release blocker: marketplace credential review

Submission https://github.com/omacom/omarchy-plugin-marketplace/issues/5962 was closed on September 22 after requested changes were not delivered. The September 15 review requires:

1. Remove the bearer-token callback URI from process arguments. `%u` in a desktop Exec entry exposes it before the shell can forward it to stdin. A D-Bus-activated application handler is one candidate to investigate and test.
2. Remove the long-lived bearer token from the WebSocket URL. Confirm Aqua's supported header-based authentication or a short-lived, narrowly scoped connection credential exchange with the team. Do not assume either is accepted.

The reviewer's closure invites a new submission once the fixes are ready. A version bump alone does not resolve these findings.

## Authentication remediation implemented

- Realtime now opens the fixed `wss://realtime.aquavoice.com` URL with `Authorization: Bearer ...` using Bun's headers option. A live check on September 23 returned `ready` with the saved login and rejected an invalid token; no audio was recorded/uploaded, and the accepted session was canceled. This is observed acceptance, not a vendor API stability guarantee.
- The callback desktop ID is `io.github.FrankIII.AquaVoice.Login.desktop`, with `DBusActivatable=true` and no URI field codes in Exec. Its GLib application receives `org.freedesktop.Application.Open` via the session bus and sends the URI to the auth helper through stdin. Its fallback does not accept a URI in argv.
- An isolated D-Bus session test exercises actual GIO desktop activation, reads the received test URI, inspects helper/child arguments, and verifies that captured output does not contain the test credential.
- Setup upgrades this plugin's old handler ID without treating it as another application's handler, and removes the recognized old Exec entry after registration succeeds. Other applications' handlers still require explicit replacement consent.
- D-Bus is a local transport, not a boundary against a compromised same-user desktop. Browser/portal handling before the URI reaches the application is outside this helper; the isolated test does not prove every browser's external-protocol launch behavior. A real browser sign-in with the new registration remains a release smoke test.

## Initial generic launcher test and subsequent portal verification

The installed Hyprland environment selects xdg-open's generic path. A dummy callback passed through `/usr/bin/xdg-open` on September 23 caused that launcher to invoke `aqua-voice-control callback-launch <dummy-uri>`, despite the desktop entry's DBusActivatable flag and lack of URI field codes. The new receiver did not authenticate it. Therefore the isolated GIO/D-Bus test does not establish a working, credential-safe browser callback on this desktop. No real token was used in this launcher test.

The direct xdg-open test covered its generic fallback, not current Chromium's preferred portal path. Further checks found two installation issues: the live session bus had not reloaded the new activation service, and the portal retained this plugin's old desktop ID. Both are now handled by registration refresh. The callback desktop entry has no Exec fallback at all, so launchers must support D-Bus activation.

Live testing on September 23 then delivered a dummy URI through `org.freedesktop.portal.OpenURI`, observed the receiver's token-free receipt status, and completed the same portal → D-Bus → auth validation → keyring → backend-restart path with the existing saved login. No token was included in a tool command argument or printed. This reused an existing credential; it did not automate a fresh OAuth-provider browser sign-in.

Installed Helium 0.17.2.1 (Chromium 153.0.8010.52) contains the portal OpenExternal implementation. Chromium's implementation prefers the portal when available; source: https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/platform_util_linux.cc . Generic xdg-open and browsers that still use an argv-based external-protocol path remain unsupported, and no insecure fallback was restored. Login preflight checks this client's handler and portal availability before opening the public sign-in page.

Regression tests cover selective portal-cache migration/restoration, actual isolated GIO activation with no Exec entry, absence of credentials in helper/child arguments and output, and refusing browser login when the portal is unavailable or a different app owns the scheme. Callback diagnostic state stores only a status and timestamp.
