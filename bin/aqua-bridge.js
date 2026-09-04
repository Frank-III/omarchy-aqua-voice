#!/usr/bin/env bun

import { createReadStream, existsSync, unlinkSync } from "node:fs";
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
import { hotkeyMatches, readHotkeyConfig, readKbOptions } from "./aqua-hotkey.js";

const VERSION = "0.10.0";
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

function shouldRetryFinalization(phase, attempts, audioBytes) {
  return phase === "processing" && attempts < 1 && audioBytes >= 3200;
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

async function paste(text) {
  const target = activeTarget();
  await setClipboard(text);
  await waitForHotkeyRelease();
  const current = activeTarget();
  if (!focusIsStable(target, current)) {
    trace("paste-skipped", { reason: "focus-changed", targetClass: target?.class || "", currentClass: current?.class || "" });
    return "Copied";
  }
  const chord = await sendPasteShortcut(current.class, current.terminal);
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
    const value = annotated.map((part) => typeof part === "string" ? part : part?.text || "").join("").trim();
    if (value) return value;
  }
  return String(message.display_text || message.raw_text || message.text || "").trim();
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

async function complete(text) {
  clearTimeout(finalTimer);
  finalTimer = null;
  state.liveText = text;
  state.latestTranscript = text;
  state.lastLatencyMs = state.processingStarted ? Date.now() - state.processingStarted : 0;
  state.processingStarted = 0;
  trace("transcript-final", { audioMs: state.lastAudioMs, latencyMs: state.lastLatencyMs, targetClass: state.targetClass });
  if (!settings().privacyMode) {
    state.history = appendHistoryEntry({
      text,
      audioMs: state.lastAudioMs,
      latencyMs: state.lastLatencyMs,
      targetClass: state.targetClass,
    });
  }
  try {
    const outcome = await paste(text);
    state.error = "";
    showCompletion(outcome);
  } catch (error) {
    state.phase = "error";
    state.error = error.message;
  } finally {
    socketGeneration += 1;
    websocket?.close(1000, "complete");
    websocket = null;
    websocketReady = false;
    clearSessionAudio();
  }
}

function handleServerMessage(event, replay) {
  if (typeof event.data !== "string") return;
  let message;
  try { message = JSON.parse(event.data); } catch { return; }
  if (message.type === "ready") {
    websocketReady = true;
    if (replay) {
      const audio = Buffer.concat(sessionAudioChunks, sessionAudioBytes);
      sendAudio(audio);
      flushAudio();
      websocket.send(JSON.stringify({ type: "stop_request", total_audio_chunks: audioCount }));
      finalTimer = setTimeout(() => fail("Aqua realtime retry timed out"), 8000);
      trace("retry-sent", { audioMs: state.lastAudioMs, chunks: audioCount });
    } else {
      flushAudio();
    }
  } else if (message.type === "document_update") {
    const text = displayText(message);
    if (text) state.liveText = text;
    if (message.final && text && state.phase === "processing") void complete(text);
  } else if (message.type === "error") {
    fail(message.message || "Aqua realtime transcription failed");
  }
}

function retryFinalization(reason) {
  retryCount += 1;
  clearTimeout(finalTimer);
  finalTimer = null;
  state.phase = "processing";
  state.stage = "retrying";
  state.error = "";
  websocketReady = false;
  socketGeneration += 1;
  try { websocket?.close(); } catch {}
  websocket = null;
  audioCount = 0;
  pendingAudio = Buffer.alloc(0);
  queuedPackets = [];
  trace("retry-finalization", { reason, audioMs: state.lastAudioMs, attempt: retryCount });
  setTimeout(() => openWebsocket(sessionConfig, sessionTarget, true), 120);
}

function fail(message) {
  trace("failure", { phase: state.phase, message, retryCount });
  if (shouldRetryFinalization(state.phase, retryCount, sessionAudioBytes)) {
    retryFinalization(message);
    return;
  }
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
  void (async () => {
    const reader = recorder.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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
    transcription_model: config.transcriptionModel,
    fast_llm_model: config.fastLLMModel || undefined,
    prompt_set: config.promptSet || undefined,
    streaming_model: config.streamingModel || undefined,
    privacy_mode: Boolean(config.privacyMode),
    memory: Boolean(config.memory),
    skip_llm: Boolean(config.skipLlm),
    casual_messaging: Boolean(config.casualMessaging),
    metadata: {
      client: "desktop",
      location: "omarchy",
      version: VERSION,
      activation_mode: "hands_free",
      dictation_experience: "real_time",
    },
    streaming: true,
    audio_format: "pcm_s16le",
  };
}

function openWebsocket(config, target, replay = false) {
  const generation = ++socketGeneration;
  const socket = new WebSocket(`wss://realtime.aquavoice.com?token=${encodeURIComponent(config.token)}`);
  websocket = socket;
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    if (generation !== socketGeneration) return;
    socket.send(JSON.stringify(startPayload(config, target)));
    state.stage = replay ? "retry-waiting-ready" : "waiting-ready";
  };
  socket.onmessage = (event) => {
    if (generation === socketGeneration) handleServerMessage(event, replay);
  };
  socket.onerror = () => {
    if (generation === socketGeneration) fail("Aqua realtime WebSocket connection failed");
  };
  socket.onclose = (event) => {
    if (generation !== socketGeneration) return;
    if (state.phase === "recording" || state.phase === "processing") {
      const detail = event.reason ? `: ${event.reason}` : ` (code ${event.code})`;
      fail(`Aqua realtime WebSocket disconnected${detail}`);
    }
  };
}

function start() {
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
  trace("recording-start", { targetClass: state.targetClass, terminal: state.targetTerminal });

  openWebsocket(config, target);
  startRecorder();
}

async function stop() {
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
  try { recorder?.kill("SIGINT"); } catch {}
  if (recorder) await recorder.exited;
  recorder = null;
  if (pendingAudio.length) {
    sendAudio(pendingAudio);
    pendingAudio = Buffer.alloc(0);
  }
  flushAudio();
  if (!websocketReady || websocket?.readyState !== WebSocket.OPEN) return fail("Aqua realtime connection was not ready");
  websocket.send(JSON.stringify({ type: "stop_request", total_audio_chunks: audioCount }));
  finalTimer = setTimeout(() => fail("Aqua realtime finalization timed out"), 8000);
}

function cancel() {
  try { recorder?.kill("SIGKILL"); } catch {}
  recorder = null;
  try { websocket?.send(JSON.stringify({ type: "stop", canceled: true })); websocket?.close(); } catch {}
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
  const stream = createReadStream(path);
  inputStreams.set(path, stream);
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
    heldHotkeyCodes.clear();
    if (state.phase === "armed" || state.phase === "recording") cancel();
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
    if (existsSync(path) && !inputStreams.has(path)) readInput(path);
  }
  state.hotkeyReady = inputStreams.size > 0;
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

export { audioFrame, displayText, focusIsStable, gestureDecision, isTerminalClass, isTrackedHotkeyCode, pasteCommand, pasteShortcut, shouldRetryFinalization, startPayload };

if (import.meta.main) {
  const command = process.argv[2];
  if (command) await runClient(command);
  else {
    startControlServer();
    scanInputs();
    setInterval(scanInputs, 1000);
    void refreshTranscriptCustomizations().catch((error) => trace("dictionary-sync-failed", { message: error.message }));
    setInterval(() => {
      void refreshTranscriptCustomizations().catch((error) => trace("dictionary-sync-failed", { message: error.message }));
    }, 60000);
  }
}
