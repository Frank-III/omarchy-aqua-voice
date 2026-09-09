#!/usr/bin/env bun

import { accessSync, constants, createReadStream, existsSync, unlinkSync } from "node:fs";
import {
  appendHistoryEntry,
  clearHistory,
  publicSettings,
  readAccountMetadata,
  readAquaSettings,
  readAquaToken,
  readHistory,
  refreshTranscriptCustomizations,
} from "./aqua-settings.js";
import { finalizationTimeout, recoverRecording, reportRecoveryOutcome } from "./aqua-recovery.js";
import { hotkeyMatches, readHotkeyConfig, readKbOptions } from "./aqua-hotkey.js";

const VERSION = "1.0.2";
const DOUBLE_TAP_MS = 650;
const PHYSICAL_DEBOUNCE_MS = 80;
const MIN_CAPTURE_MS = 100;
const HOTKEY_CODES = new Map([
  [29, "Ctrl"],
  [42, "Shift"],
  [54, "Shift"],
  [56, "Alt→Super"],
  [58, "Caps→Ctrl"],
  [97, "Ctrl"],
  [100, "Alt→Super"],
  [125, "Super"],
  [126, "Super"],
  [193, "F23"],
]);
const socketPath = process.env.AQUA_VOICE_SOCKET || `${process.env.XDG_RUNTIME_DIR || "/tmp"}/aqua-voice.sock`;
const inputStreams = new Map();
const buffers = new WeakMap();
const initialHistory = readHistory();

const state = {
  phase: "idle",
  stage: "",
  completion: "",
  recordingStarted: 0,
  processingStarted: 0,
  lastAudioMs: 0,
  lastLatencyMs: 0,
  latestTranscript: initialHistory[0]?.text || "",
  liveText: "",
  error: "",
  hotkeyReady: false,
  hotkeyTaps: 0,
  lastTap: 0,
  completionGeneration: 0,
  targetAddress: null,
  targetClass: "",
  targetTerminal: false,
  history: initialHistory,
};

let websocket = null;
let websocketReady = false;
let recorder = null;
let recorderDrain = Promise.resolve();
let delivery = null;
let audioCount = 0;
let pendingAudio = Buffer.alloc(0);
let queuedPackets = [];
let finalTimer = null;
let clipboardProvider = null;
let lastPhysicalTap = 0;
let socketGeneration = 0;
let sessionAudioChunks = [];
let sessionAudioBytes = 0;
let sessionConfig = null;
let sessionTarget = null;
let retryCount = 0;
let sessionContext = null;
const heldHotkeyCodes = new Set();
let hotkeyConfig = readHotkeyConfig();
let kbOptions = readKbOptions();
let hotkeyConfigSnapshot = JSON.stringify(hotkeyConfig);
let lastKbOptionsRefresh = 0;

function trace(event, details = {}) {
  console.error(`[aqua] ${event} ${JSON.stringify(details)}`);
}

function isTrackedHotkeyCode(code) {
  return HOTKEY_CODES.has(code);
}

function clearSessionAudio() {
  sessionAudioChunks = [];
  sessionAudioBytes = 0;
}


function settings() {
  return readAquaSettings();
}

function status(ok = true) {
  return {
    ok,
    version: VERSION,
    phase: state.phase,
    stage: state.stage,
    completion: state.completion,
    recording: state.phase === "recording",
    processing: state.phase === "processing",
    processingMs: state.processingStarted ? Date.now() - state.processingStarted : 0,
    retryCount,
    lastLatencyMs: state.lastLatencyMs,
    lastAudioMs: state.lastAudioMs,
    hotkeyReady: state.hotkeyReady,
    hotkeyTaps: state.hotkeyTaps,
    hotkeyDisplay: hotkeyConfig.display,
    microphone: "PipeWire → Aqua realtime",
    pasteWithShift: state.targetTerminal,
    tokenPresent: Boolean(readAquaToken(settings())),
    account: readAccountMetadata(),
    connected: websocket?.readyState === WebSocket.OPEN,
    latestTranscript: state.latestTranscript,
    liveText: state.liveText,
    settings: publicSettings(settings()),
    history: state.history,
    error: state.error,
  };
}

function activeTarget() {
  const result = Bun.spawnSync(["hyprctl", "activewindow", "-j"]);
  if (!result.success) return null;
  try {
    const window = JSON.parse(result.stdout.toString());
    if (!window.address?.startsWith("0x") || !window.class || window.class === "aqua-voice") return null;
    const tags = Array.isArray(window.tags) ? window.tags.map(String) : [];
    const terminal = tags.some((tag) => tag.replace(/\*$/, "") === "terminal") || isTerminalClass(window.class);
    return { address: window.address, class: window.class, title: window.title || "", terminal };
  } catch {
    return null;
  }
}

function isTerminalClass(windowClass) {
  return /(^|\.)(ghostty|foot|kitty|alacritty)$|wezterm|org\.gnome\.terminal|konsole/i.test(windowClass || "");
}

function focusIsStable(target, current) {
  return Boolean(target?.address && current?.address && target.address === current.address);
}

function pasteShortcut(windowClass, terminalTagged = false) {
  if (terminalTagged || isTerminalClass(windowClass)) return { mods: "SHIFT", key: "Insert", label: "Shift+Insert" };
  return { mods: "CTRL", key: "V", label: "Ctrl+V" };
}

function pasteCommand(windowClass, terminalTagged = false) {
  if (terminalTagged || isTerminalClass(windowClass)) {
    return ["wtype", "-M", "shift", "-k", "Insert", "-m", "shift", "-p", "VoidSymbol"];
  }
  return ["wtype", "-M", "ctrl", "-k", "v", "-m", "ctrl", "-p", "VoidSymbol"];
}

async function sendPasteShortcut(windowClass, terminalTagged) {
  const shortcut = pasteShortcut(windowClass, terminalTagged);
  const dispatch = (stateValue) => Bun.spawnSync([
    "hyprctl",
    "dispatch",
    `hl.dsp.send_key_state({ mods = "${shortcut.mods}", key = "${shortcut.key}", state = "${stateValue}" })`,
  ]);
  const down = dispatch("down");
  if (down.success) {
    await Bun.sleep(50);
    const up = dispatch("up");
    if (up.success) return shortcut.label;
  }
  const fallback = Bun.spawnSync(pasteCommand(windowClass, terminalTagged));
  if (!fallback.success) throw new Error("could not send the Wayland paste shortcut");
  return shortcut.label;
}

async function waitForHotkeyRelease(maxWaitMs = 700) {
  const started = Date.now();
  while (heldHotkeyCodes.size > 0 && Date.now() - started < maxWaitMs) await Bun.sleep(15);
  const waitedMs = Date.now() - started;
  if (waitedMs > 0) {
    trace("hotkey-release-wait", {
      waitedMs,
      remaining: [...heldHotkeyCodes].map((code) => HOTKEY_CODES.get(code)),
    });
  }
  return waitedMs;
}

async function setClipboard(text) {
  try { clipboardProvider?.kill("SIGTERM"); } catch {}
  clipboardProvider = Bun.spawn(
    ["wl-copy", "--foreground", "--type", "text/plain;charset=utf-8"],
    { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
  );
  clipboardProvider.stdin.write(text);
  clipboardProvider.stdin.end();
  await Bun.sleep(100);
  if (clipboardProvider.exitCode !== null && clipboardProvider.exitCode !== 0) {
    const message = (await new Response(clipboardProvider.stderr).text()).trim();
    clipboardProvider = null;
    throw new Error(message || "wl-copy failed");
  }
}

async function paste(text, isActive = () => true) {
  if (!isActive()) return "Canceled";
  const target = activeTarget();
  await setClipboard(text);
  await waitForHotkeyRelease();
  if (!isActive()) return "Canceled";
  const current = activeTarget();
  if (!focusIsStable(target, current)) {
    trace("paste-skipped", { reason: "focus-changed", targetClass: target?.class || "", currentClass: current?.class || "" });
    return "Copied";
  }
  let chord;
  try { chord = await sendPasteShortcut(current.class, current.terminal); }
  catch (error) {
    trace("paste-shortcut-failed", { message: error.message, fallback: "clipboard" });
    return "Copied";
  }
  trace("paste", { targetClass: current.class, terminal: current.terminal, chord });
  return "Pasted";
}

function historyEntry(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id || "")) throw new Error("invalid history entry id");
  const entry = state.history.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("history entry not found");
  return entry;
}

function showCompletion(label) {
  state.phase = "complete";
  state.stage = "";
  state.completion = label;
  const generation = ++state.completionGeneration;
  setTimeout(() => {
    if (state.phase === "complete" && state.completionGeneration === generation) {
      state.phase = "idle";
      state.completion = "";
    }
  }, 1800);
}

function displayText(message) {
  const annotated = message.display_text_annotated;
  if (Array.isArray(annotated)) {
    return annotated
      .filter((part) => part?.type !== "deleted")
      .map((part) => typeof part === "string" ? part : part?.text || "")
      .join("");
  }
  return String(message.display_text || message.raw_text || message.text || "");
}

function audioFrame(payload) {
  const header = Buffer.alloc(8);
  header.writeUInt8(1, 0);
  header.writeUInt8(0, 1);
  header.writeUInt16BE(audioCount++, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(Math.ceil(payload.length / 1024), 6);
  return Buffer.concat([header, payload]);
}

function sendAudio(payload) {
  for (let offset = 0; offset < payload.length; offset += 3200) {
    const packet = audioFrame(payload.subarray(offset, Math.min(offset + 3200, payload.length)));
    if (websocketReady && websocket?.readyState === WebSocket.OPEN) websocket.send(packet);
    else queuedPackets.push(packet);
  }
}

function flushAudio() {
  if (!websocketReady || websocket?.readyState !== WebSocket.OPEN) return;
  for (const packet of queuedPackets.splice(0)) websocket.send(packet);
}

// Keep the transport alive for the server's close, with bounded cleanup if it
// never closes. WebSocket.close queues its close frame behind pending messages.
function finishSocket(socket, message, timeoutMs = 5000) {
  if (!socket || socket.readyState >= WebSocket.CLOSING) return;
  const timer = setTimeout(() => socket.close(1000, "stop timeout"), timeoutMs);
  timer.unref?.();
  socket.addEventListener("close", () => clearTimeout(timer), { once: true });
  const send = () => {
    try { socket.send(JSON.stringify(message)); }
    catch (error) {
      clearTimeout(timer);
      trace("stop-send-failed", { message: error.message });
      socket.close();
    }
  };
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.addEventListener("open", send, { once: true });
  } else send();
}

function createDelivery(socket, report = finishSocket) {
  let claimed = false;
  let canceled = false;
  return {
    get claimed() { return claimed; },
    cancel() {
      if (canceled) return;
      canceled = true;
      report(socket, { type: "stop", canceled: true });
    },
    async run(text, insert) {
      if (claimed || canceled) return null;
      claimed = true; // Claim before insertion yields, including empty finals.
      let outcome = "No text returned";
      try {
        if (text) outcome = await insert(text, () => !canceled);
        return canceled ? null : outcome;
      } finally {
        if (!canceled) report(socket, {
          type: "stop",
          content: text,
          canceled: false,
          mode: "hands_free",
        });
      }
    },
  };
}

async function complete(text) {
  const currentDelivery = delivery;
  if (!currentDelivery || currentDelivery.claimed) return;
  clearTimeout(finalTimer);
  finalTimer = null;
  state.lastLatencyMs = state.processingStarted ? Date.now() - state.processingStarted : 0;
  state.processingStarted = 0;
  trace("transcript-final", { audioMs: state.lastAudioMs, latencyMs: state.lastLatencyMs, targetClass: state.targetClass });
  // The panel is also a delivery route, including when clipboard setup fails.
  state.liveText = text;
  if (text) state.latestTranscript = text;
  try {
    const outcome = await currentDelivery.run(text, async (value, active) => {
      try { return await paste(value, active); }
      catch (error) {
        trace("clipboard-failed", { message: error.message, fallback: "panel" });
        return "Text ready in Aqua";
      }
    });
    if (delivery !== currentDelivery || outcome === null) return;
    state.liveText = text;
    if (text) {
      state.latestTranscript = text;
      if (!settings().privacyMode) {
        state.history = appendHistoryEntry({
          text,
          audioMs: state.lastAudioMs,
          latencyMs: state.lastLatencyMs,
          targetClass: state.targetClass,
        });
      }
    }
    state.error = "";
    showCompletion(outcome);
  } catch (error) {
    if (delivery !== currentDelivery) return;
    state.phase = "error";
    state.error = error.message;
  } finally {
    if (delivery === currentDelivery) {
      socketGeneration += 1;
      websocket = null;
      websocketReady = false;
      delivery = null;
      clearSessionAudio();
    }
  }
}

function handleServerMessage(event) {
  if (typeof event.data !== "string") return;
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "ready") {
    websocketReady = true;
    flushAudio();
  } else if (message.type === "set_session_id") {
    if ((typeof message.session_id === "number" && Number.isSafeInteger(message.session_id))
        || (typeof message.session_id === "string" && /^\d+$/.test(message.session_id))) {
      sessionContext.id = message.session_id;
      trace("session-id", { sessionId: sessionContext.id });
    }
  } else if (message.type === "document_update") {
    const text = displayText(message);
    state.liveText = text;
    if (message.final && state.phase === "processing") void complete(text);
  } else if (message.type === "error") {
    fail(message.message || "Aqua realtime transcription failed", false);
  }
}

async function recoverSession(reason) {
  const context = sessionContext;
  if (!context || context.recoveryType || delivery?.claimed) return;
  clearTimeout(finalTimer);
  finalTimer = null;
  context.recoveryType = context.stopSent ? "server_recovery" : "http";
  retryCount = 1;
  state.stage = "recovering";
  websocketReady = false;
  socketGeneration += 1; // A late WebSocket result cannot also insert text.
  trace("recovery-start", { reason, sessionId: context.id, type: context.recoveryType });
  try {
    const text = await recoverRecording({
      stopSent: context.stopSent, sessionId: context.id,
      audio: context.stopSent ? null : Buffer.concat(sessionAudioChunks, sessionAudioBytes),
      language: sessionConfig.language, token: sessionConfig.token,
      signal: context.controller.signal, socket: websocket,
    });
    if (sessionContext !== context || context.controller.signal.aborted) return;
    await complete(text);
  } catch (error) {
    if (sessionContext === context && !context.controller.signal.aborted) fail(error.message, false);
  }
}

function fail(message, recover = true) {
  if (recover && sessionContext?.stopping) return;
  if (delivery?.claimed) return;
  trace("failure", { phase: state.phase, message, retryCount });
  if (recover && state.phase === "processing" && sessionContext && !sessionContext.recoveryType) {
    void recoverSession(message);
    return;
  }
  sessionContext?.controller.abort();
  clearTimeout(finalTimer);
  finalTimer = null;
  state.phase = "error";
  state.stage = "";
  state.processingStarted = 0;
  state.error = message;
  try { recorder?.kill("SIGKILL"); } catch {}
  recorder = null;
  socketGeneration += 1;
  try { websocket?.close(); } catch {}
  websocket = null;
  websocketReady = false;
  clearSessionAudio();
  const generation = ++state.completionGeneration;
  setTimeout(() => {
    if (state.phase === "error" && state.completionGeneration === generation) state.phase = "idle";
  }, 2600);
}

function startRecorder() {
  recorder = Bun.spawn(["pw-record", "--raw", "--rate", "16000", "--channels", "1", "--format", "s16", "-"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const generation = socketGeneration;
  const capture = recorder;
  recorderDrain = (async () => {
    const reader = capture.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || generation !== socketGeneration) break;
        const chunk = Buffer.from(value);
        sessionAudioChunks.push(chunk);
        sessionAudioBytes += chunk.length;
        pendingAudio = Buffer.concat([pendingAudio, chunk]);
        const completeBytes = pendingAudio.length - (pendingAudio.length % 3200);
        if (completeBytes > 0) {
          sendAudio(pendingAudio.subarray(0, completeBytes));
          pendingAudio = pendingAudio.subarray(completeBytes);
        }
      }
    } catch (error) {
      if (state.phase === "recording") fail(`microphone failed: ${error.message}`);
    }
  })();
}

function startPayload(config, target) {
  return {
    type: "start",
    language_code: config.language || "en",
    sample_rate: 16000,
    channel_count: 1,
    microphone: "PipeWire default",
    context: { app: target?.class || "" },
    is_trial: false,
    transcription_model: config.transcriptionModel || "avalon-v1.1",
    fast_llm_model: config.fastLLMModel || undefined,
    prompt_set: config.promptSet || undefined,
    streaming_model: config.streamingModel || undefined,
    privacy_mode: Boolean(config.privacyMode),
    memory: Boolean(config.memory),
    skip_llm: Boolean(config.skipLlm),
    casual_messaging: Boolean(config.casualMessaging),
    metadata: {
      client: "linux",
      location: "omarchy",
      version: VERSION,
      activation_mode: "hands_free",
      dictation_experience: "real_time",
    },
    streaming: true,
    audio_format: "pcm_s16le",
  };
}

function openWebsocket(config, target) {
  const generation = ++socketGeneration;
  const socket = new WebSocket(`wss://realtime.aquavoice.com?token=${encodeURIComponent(config.token)}`);
  websocket = socket;
  const context = sessionContext;
  delivery = createDelivery(socket, (transport, message) => {
    if (context.recoveryType && !message.canceled) {
      void reportRecoveryOutcome(context.id, context.recoveryType, message.content, config.token)
        .catch((error) => trace("recovery-outcome-failed", { message: error.message }));
    } else finishSocket(transport, message);
  });
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    if (generation !== socketGeneration) return;
    socket.send(JSON.stringify(startPayload(config, target)));
    state.stage = "waiting-ready";
  };
  socket.onmessage = (event) => {
    if (generation === socketGeneration) handleServerMessage(event);
  };
  socket.onerror = () => {
    if (generation === socketGeneration) {
      if (state.phase === "recording") void stop();
      else fail("Aqua realtime WebSocket connection failed");
    }
  };
  socket.onclose = (event) => {
    if (generation !== socketGeneration) return;
    if (state.phase === "recording" || state.phase === "processing") {
      const detail = event.reason ? `: ${event.reason}` : ` (code ${event.code})`;
      if (state.phase === "recording") void stop();
      else fail(`Aqua realtime WebSocket disconnected${detail}`);
    }
  };
}

function start() {
  if (state.phase === "recording" || state.phase === "processing") return;
  const config = settings();
  config.token = readAquaToken(config, true);
  if (!config.token) throw new Error("Aqua login token is missing");
  state.phase = "recording";
  state.stage = "connecting";
  state.recordingStarted = Date.now();
  state.processingStarted = 0;
  const target = activeTarget();
  state.targetAddress = target?.address || null;
  state.targetClass = target?.class || "";
  state.targetTerminal = target?.terminal === true;
  state.liveText = "";
  state.error = "";
  state.lastTap = 0;
  audioCount = 0;
  pendingAudio = Buffer.alloc(0);
  queuedPackets = [];
  clearSessionAudio();
  sessionConfig = config;
  sessionTarget = target;
  retryCount = 0;
  sessionContext = { id: null, stopSent: false, recoveryType: null, controller: new AbortController() };
  trace("recording-start", { targetClass: state.targetClass, terminal: state.targetTerminal });

  openWebsocket(config, target);
  startRecorder();
}

async function stop() {
  if (state.phase !== "recording") return;
  const generation = socketGeneration;
  const capture = recorder;
  const drain = recorderDrain;
  const context = sessionContext;
  context.stopping = true;
  state.lastAudioMs = state.recordingStarted ? Date.now() - state.recordingStarted : 0;
  trace("recording-stop", { audioMs: state.lastAudioMs });
  if (state.lastAudioMs < MIN_CAPTURE_MS) {
    cancel();
    showCompletion("Too short");
    return;
  }
  state.recordingStarted = 0;
  state.processingStarted = Date.now();
  state.phase = "processing";
  state.stage = "finalizing";
  try { capture?.kill("SIGINT"); } catch {}
  if (capture) await capture.exited;
  await drain;
  context.stopping = false;
  if (generation !== socketGeneration) return;
  recorder = null;
  if (pendingAudio.length) {
    sendAudio(pendingAudio);
    pendingAudio = Buffer.alloc(0);
  }
  flushAudio();
  if (!websocketReady || websocket?.readyState !== WebSocket.OPEN) return fail("Aqua realtime connection was not ready");
  try { websocket.send(JSON.stringify({ type: "stop_request", total_audio_chunks: audioCount })); }
  catch { return fail("Aqua realtime connection closed before stop_request"); }
  sessionContext.stopSent = true;
  finalTimer = setTimeout(() => fail("Aqua realtime finalization timed out"), finalizationTimeout(state.lastAudioMs));
}

function cancel() {
  sessionContext?.controller.abort();
  try { recorder?.kill("SIGKILL"); } catch {}
  recorder = null;
  try { delivery?.cancel(); } catch {}
  delivery = null;
  websocket = null;
  websocketReady = false;
  socketGeneration += 1;
  clearTimeout(finalTimer);
  finalTimer = null;
  state.phase = "idle";
  state.stage = "";
  state.completion = "";
  state.recordingStarted = 0;
  state.processingStarted = 0;
  state.lastTap = 0;
  state.error = "";
  clearSessionAudio();
}

function gestureDecision(phase, lastTap, now) {
  if (phase === "recording") return "stop";
  if (phase === "processing") return "ignore";
  if (phase === "armed" && now - lastTap <= DOUBLE_TAP_MS) return "start";
  return "arm";
}

function tap() {
  const now = Date.now();
  const decision = gestureDecision(state.phase, state.lastTap, now);
  trace("gesture", { phase: state.phase, decision, gapMs: state.lastTap ? now - state.lastTap : null });
  if (decision === "stop") return void stop();
  if (decision === "ignore") return;
  if (decision === "start") return start();
  state.phase = "armed";
  state.lastTap = now;
  setTimeout(() => {
    if (state.phase === "armed" && Date.now() - state.lastTap >= DOUBLE_TAP_MS) {
      state.phase = "idle";
      state.lastTap = 0;
    }
  }, DOUBLE_TAP_MS + 10);
}

function execute(command) {
  if (command === "status" || command === "ping") return;
  if (command === "tap") return tap();
  if (command === "start") return start();
  if (command === "stop") return void stop();
  if (command === "cancel") return cancel();
  if (command === "clear-history") {
    state.history = clearHistory();
    return;
  }
  if (command.startsWith("copy-history:")) {
    const entry = historyEntry(command.slice("copy-history:".length));
    void setClipboard(entry.text).then(() => showCompletion("Copied")).catch((error) => fail(error.message));
    return;
  }
  if (command.startsWith("paste-history:")) {
    const entry = historyEntry(command.slice("paste-history:".length));
    void paste(entry.text).then(showCompletion).catch((error) => fail(error.message));
    return;
  }
  if (command === "paste-last") {
    if (!state.latestTranscript) throw new Error("there is no completed dictation to paste");
    void paste(state.latestTranscript).then(showCompletion).catch((error) => fail(error.message));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

function startControlServer() {
  try { unlinkSync(socketPath); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  Bun.listen({
    unix: socketPath,
    socket: {
      data(socket, data) {
        const command = ((buffers.get(socket) || "") + data.toString()).trim();
        if (!command) return;
        let ok = true;
        try { execute(command); } catch (error) { ok = false; state.error = error.message; }
        socket.write(JSON.stringify(status(ok)));
        socket.end();
      },
      close(socket) { buffers.delete(socket); },
      error() {},
    },
  });
}

function readInput(path) {
  let opened = false;
  const stream = createReadStream(path);
  inputStreams.set(path, stream);
  stream.on("open", () => { opened = true; });
  let pending = Buffer.alloc(0);
  stream.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 24) {
      const event = pending.subarray(0, 24);
      pending = pending.subarray(24);
      if (event.readUInt16LE(16) !== 1) continue;
      const code = event.readUInt16LE(18);
      const value = event.readInt32LE(20);
      if (isTrackedHotkeyCode(code) || code === hotkeyConfig.keyCode) {
        if (value === 0) heldHotkeyCodes.delete(code);
        else if (value === 1) heldHotkeyCodes.add(code);
      }
      if (code === hotkeyConfig.keyCode && value === 1
          && hotkeyMatches(hotkeyConfig, code, heldHotkeyCodes, kbOptions)) {
        const now = Date.now();
        if (now - lastPhysicalTap < PHYSICAL_DEBOUNCE_MS) {
          trace("physical-tap-debounced", { device: path, gapMs: now - lastPhysicalTap });
          continue;
        }
        lastPhysicalTap = now;
        state.hotkeyTaps += 1;
        try { tap(); } catch (error) { state.error = error.message; }
      } else if (code === 1 && value === 1) cancel();
    }
  });
  const disconnected = () => {
    inputStreams.delete(path);
    if (opened) {
      heldHotkeyCodes.clear();
      if (state.phase === "armed" || state.phase === "recording") cancel();
    }
  };
  stream.on("close", disconnected);
  stream.on("error", disconnected);
}

function scanInputs() {
  const nextConfig = readHotkeyConfig();
  const nextSnapshot = JSON.stringify(nextConfig);
  if (nextSnapshot !== hotkeyConfigSnapshot) {
    hotkeyConfig = nextConfig;
    hotkeyConfigSnapshot = nextSnapshot;
    heldHotkeyCodes.clear();
    trace("hotkey-config", { display: hotkeyConfig.display });
  }
  if (Date.now() - lastKbOptionsRefresh > 5000) {
    kbOptions = readKbOptions();
    lastKbOptionsRefresh = Date.now();
  }
  for (let index = 0; index < 64; index++) {
    const path = `/dev/input/event${index}`;
    if (inputStreams.has(path)) continue;
    try { accessSync(path, constants.R_OK); } catch { continue; }
    readInput(path);
  }
  state.hotkeyReady = [...inputStreams.values()].some((stream) => !stream.pending && !stream.destroyed);
}

async function runClient(command) {
  let response = "";
  await new Promise((resolve, reject) => {
    Bun.connect({
      unix: socketPath,
      socket: {
        open(socket) { socket.write(command); },
        data(_socket, data) { response += data.toString(); },
        close() { resolve(); },
        error(_socket, error) { reject(error); },
      },
    }).catch(reject);
  });
  console.log(response);
  if (!JSON.parse(response).ok) process.exitCode = 1;
}

export { createDelivery, finishSocket, audioFrame, displayText, focusIsStable, gestureDecision, isTerminalClass, isTrackedHotkeyCode, pasteCommand, pasteShortcut, startPayload };

if (import.meta.main) {
  const command = process.argv[2];
  if (command) await runClient(command);
  else {
    startControlServer();
    scanInputs();
    setInterval(scanInputs, 1000);
    if (readAquaToken(settings())) void refreshTranscriptCustomizations().catch((error) => trace("dictionary-sync-failed", { message: error.message }));

  }
}
