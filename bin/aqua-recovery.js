const realtime = "https://realtime.aquavoice.com";

export function finalizationTimeout(audioMs) {
  return 15000 + Math.ceil(Math.max(0, audioMs) / 60);
}

export function pcmWav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export async function pollSessionRecovery(sessionId, token, signal, { fetcher = fetch, intervalMs = 1000, timeoutMs = 90000 } = {}) {
  if (sessionId == null) throw new Error("Aqua did not provide a session ID for recovery");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  while (true) {
    deadline.throwIfAborted();
    try {
      const response = await fetcher(`${realtime}/session-recovery/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.any([deadline, AbortSignal.timeout(10000)]),
      });
      if (response.status === 401 || response.status === 403) throw new Error("Aqua recovery requires signing in again");
      if (response.ok) {
        const result = await response.json();
        if (result.state === "empty") return "";
        if (result.state === "ready" && typeof result.text === "string") return result.text;
      }
    } catch (error) {
      deadline.throwIfAborted();
      if (error.message === "Aqua recovery requires signing in again") throw error;
    }
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(deadline.reason); };
      const timer = setTimeout(() => { deadline.removeEventListener("abort", abort); resolve(); }, intervalMs);
      deadline.addEventListener("abort", abort, { once: true });
      if (deadline.aborted) abort();
    });
  }
}

export async function retranscribe(pcm, sessionId, language, token, signal, fetcher = fetch) {
  const form = new FormData();
  form.set("audio", new Blob([pcmWav(pcm)], { type: "audio/wav" }), "recording.wav");
  if (sessionId != null) form.set("sessionId", String(sessionId));
  form.set("language", language || "en");
  form.set("origin", "websocket_fallback");
  const response = await fetcher(`${realtime}/retranscribe`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
    signal: AbortSignal.any([signal, AbortSignal.timeout(90000)]),
  });
  if (!response.ok) throw new Error(`Aqua audio recovery failed (${response.status})`);
  const result = await response.json();
  if (result.success !== true || typeof result.transcription !== "string") throw new Error("Aqua audio recovery returned no valid result");
  return result.transcription;
}

export async function reportRecoveryOutcome(sessionId, type, text, token, fetcher = fetch) {
  if (sessionId == null) return;
  const response = await fetcher("https://core.aquavoice.com/recovery-outcome/", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, recovery_type: type, inserted_text_length: text.length }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Aqua recovery outcome report failed (${response.status})`);
}

export async function recoverRecording({ stopSent, sessionId, audio, language, token, signal, socket }, options = {}) {
  try { socket?.close(4003, "recovery requested"); } catch {}
  if (stopSent) return pollSessionRecovery(sessionId, token, signal, options);
  return retranscribe(audio, sessionId, language, token, signal, options.fetcher);
}
