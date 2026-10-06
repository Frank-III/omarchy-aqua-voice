# Aqua upstream audit — 2026-10-06

## Verified releases

The official stable macOS updater feed reports **0.20.16**, published **2026-10-02T22:18:19.942Z**:
https://updates.aquavoice.com/stable/darwin/arm64/RELEASES.json

Inspected artifact:
https://updates.aquavoice.com/stable/darwin/Aqua%20Voice-darwin-0.20.16.zip

Extracted package.json reports 0.20.16. Local app.asar SHA-256:
`8ba26fc90e07f520cb9848307d65578dc3f1b901461027b5ec2e012cc021203c`.

The previous 0.20.0 artifact was re-extracted for direct comparison; its hash matches the September audit (`168370ccadd08f56bb5e47db28b9fc107c52891073c5278fb97ad902329997a7`). These hashes identify the inspected files, not vendor signatures. Reference extracts are retained outside the repository under `~/aqua-voice-linux/upstream-0.20.0/` and `upstream-0.20.16/`.

## Changes relevant to this client

1. **Continual Learning retired:** main-bundle settings migration 88 deletes `memory`. The settings schema and realtime start builder no longer include it. Our 1.0.3 still exposes and sends it.
2. **Prompt-set override retired:** migration 90 deletes `promptSet`; the realtime builder no longer sends `prompt_set`. Our 1.0.3 can still send a legacy value.
3. **No change found in the inspected core contracts:** 16 kHz mono PCM16, stop_request, annotated final documents, session IDs, close code 4003, original-session recovery, retranscription origin, recovery outcome reporting, dictionary HEAD revision header, replacement operations, and sign-in/callback anchors remain present.
4. **Timing and model unchanged:** the desktop still uses 15 seconds plus one second per completed minute of audio, and the default settings still reference AvalonV11. Do not invent a new model wire ID from marketing version names.
5. **Native desktop features are separate scope:** the public changelog highlights macOS Liquid Glass and earlier Windows-native audio improvements. Neither changes our PipeWire capture or requires replacing the user's preferred recording animation. A microphone picker is a useful existing feature gap, not a newly discovered protocol requirement.

## Prepared patch: plugin 1.0.4

- Remove the Continual Learning toggle and exported UI setting.
- Stop sending memory and prompt_set, including when older config files contain them.
- Stop coupling local privacy changes to the retired memory preference.
- Preserve existing config files and legacy keys; there is no destructive settings migration.
- Extend static compatibility output to report upstream removal migrations.
- Add regression coverage proving legacy fields are ignored without mutating the input preferences.

Validation: 52 tests pass; plugin validation and diff checks pass; all 16 protocol anchors match 0.20.16. These are static comparisons and local tests, not a guarantee of all server behavior or an end-to-end fresh OAuth test. No audio, account data, or preferences were changed during the audit; no version was installed or pushed.

## Follow-up priorities

- Release the small 1.0.4 compatibility patch after review; an upstream patch release alone does not require matching its version number.
- Keep the header-auth/D-Bus protections from 1.0.3. Do not restore token URLs or argv-based callbacks for desktop parity.
- Finish a fresh browser-provider sign-in before marketplace resubmission. The earlier live portal handoff reused an existing credential.
- Separately investigate connection-readiness stalls with connect/open/ready/stop timing diagnostics. This audit does not establish that the prior intermittent latency report is fixed.

Public changelog checked: https://aquavoice.com/changelog (latest displayed desktop entry was 0.20.0; it does not describe the 0.20.16 patch in detail).

## Follow-up implementation

The 1.0.4 working tree now also adds a PipeWire microphone picker (stable node names, System default, refresh, unavailable-device indication), a single bounded connection-readiness budget, continued capture when a connection becomes unavailable, capture-start/exit checks, and timing diagnostics. A short recording waits for the remaining ready budget before choosing HTTP recovery; it never opens a replay WebSocket. Cancellation aborts the wait without triggering recovery.

Validation after implementation: 56 tests pass, plugin validation passes, and the actual Settings component rendered offscreen without QML errors. Live pw-dump discovery returned three sources plus System default. A one-second default-device capture delivered PCM, with the first chunk observed at 198 ms in that check; the data was discarded without saving or uploading it. This is a functional capture check, not a comparative latency benchmark. Live Aqua session recovery and a fresh OAuth-provider sign-in were not exercised. The running installation has not been changed.
