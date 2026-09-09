#!/usr/bin/env bun

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const home = process.env.HOME;
const settingsPath = process.env.AQUA_SETTINGS_PATH || `${home}/.config/Aqua Voice/settings.json`;
const historyPath = process.env.AQUA_HISTORY_PATH || `${home}/.local/state/aqua-voice/history.json`;
const accountPath = process.env.AQUA_ACCOUNT_PATH || `${home}/.local/state/aqua-voice/account.json`;
const customizationsUrl = "https://core.aquavoice.com/users/transcript-customizations/";
// Language enum recovered from Aqua macOS 0.19.8 settings schema.
const supportedLanguageCodes = "auto ar be bn bg yue ca hr cs da nl en et fi fr gl de el he hi hu id ga it ja ko lv lt ms mt cmn mr mn no fa pl pt ro ru sl es sw sv ta th tr uk ur vi cy yi".split(" ");
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const supportedLanguages = supportedLanguageCodes.map((value) => ({
  value,
  label: value === "auto" ? "Auto-detect" : value === "cmn" ? "Chinese (Mandarin)" : value === "yue" ? "Chinese (Cantonese)" : languageNames.of(value),
}));
let cachedToken = "";
let cachedTokenAt = 0;
const booleanSettings = new Set([
  "privacyMode",
  "memory",
  "skipLlm",
  "casualMessaging",
]);

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function readAquaSettings() {
  return readJson(settingsPath, {});
}

function readKeyringToken() {
  const result = Bun.spawnSync(["secret-tool", "lookup", "service", "aqua-voice", "account", "default"]);
  return result.success ? result.stdout.toString().trim() : "";
}

function readAquaToken(config = readAquaSettings(), refresh = false) {
  const environmentToken = String(process.env.AQUA_VOICE_TOKEN || "").trim();
  if (environmentToken) return environmentToken;
  if (!refresh && Date.now() - cachedTokenAt < 5000) return cachedToken;
  cachedToken = readKeyringToken() || String(config.token || "").trim();
  cachedTokenAt = Date.now();
  return cachedToken;
}

async function storeAquaToken(token) {
  const value = String(token || "").trim();
  if (!value || value.length > 8192 || /\s/.test(value)) throw new Error("invalid Aqua token");
  const child = Bun.spawn(
    ["secret-tool", "store", "--label=Aqua Voice", "service", "aqua-voice", "account", "default"],
    { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
  );
  child.stdin.write(value);
  child.stdin.end();
  if ((await child.exited) !== 0) {
    throw new Error((await new Response(child.stderr).text()).trim() || "could not store Aqua token in Secret Service");
  }
  const config = readAquaSettings();
  config.token = "";
  atomicWrite(settingsPath, config);
  cachedToken = value;
  cachedTokenAt = Date.now();
}

function clearAquaToken() {
  if (process.env.AQUA_VOICE_TOKEN?.trim()) throw new Error("Remove AQUA_VOICE_TOKEN from the backend environment to sign out");
  const cleared = Bun.spawnSync(["secret-tool", "clear", "service", "aqua-voice", "account", "default"]);
  if (!cleared.success) throw new Error("Could not remove the Aqua login from Secret Service. Unlock the keyring and try again.");
  const config = readAquaSettings();
  config.token = "";
  atomicWrite(settingsPath, config);
  cachedToken = "";
  cachedTokenAt = Date.now();
}

function readAccountMetadata() {
  const account = readJson(accountPath, {});
  return {
    email: typeof account.email === "string" ? account.email : "",
    name: typeof account.name === "string" ? account.name : "",
    plan: typeof account.plan === "string" ? account.plan : "",
    validatedAt: typeof account.validatedAt === "string" ? account.validatedAt : "",
  };
}

function writeAccountMetadata(account) {
  atomicWrite(accountPath, {
    email: String(account.email || ""),
    name: String(account.name || ""),
    plan: String(account.plan || ""),
    validatedAt: new Date().toISOString(),
  });
}

function clearAccountMetadata() {
  atomicWrite(accountPath, {});
}

function publicSettings(config = readAquaSettings()) {
  const dictionary = Array.isArray(config.dictionary)
    ? config.dictionary.filter((word) => typeof word === "string" && word.trim()).slice(0, 800)
    : [];
  return {
    language: String(config.language || "en"),
    supportedLanguages,
    savedLanguages: Array.isArray(config.savedLanguages)
      ? config.savedLanguages.filter((value) => typeof value === "string")
      : ["en"],
    transcriptionModel: String(config.transcriptionModel || "avalon-v1.1"),
    streamingMode: String(config.streamingMode || "never"),
    privacyMode: config.privacyMode === true,
    memory: config.memory === true,
    skipLlm: config.skipLlm === true,
    casualMessaging: config.casualMessaging === true,
    dictionary,
    dictionaryCount: dictionary.length,
    replacements: Array.isArray(config.replacements) ? config.replacements : [],
    customInstructions: typeof config.customInstructions === "string" ? config.customInstructions : "",
    customizationSyncedAt: config._aquaOmarchyCustomizationSyncedAt || "",
    replacementCount: Array.isArray(config.replacements) ? config.replacements.length : 0,
    customInstructionsConfigured: typeof config.customInstructions === "string"
      && config.customInstructions.trim().length > 0,
    wordCount: Number.isFinite(config.wordCount) ? config.wordCount : 0,
  };
}

function normalizeTranscriptCustomizations(response) {
  const source = response?.customizations || response || {};
  return {
    revision: Number.isFinite(response?.revision) ? response.revision : null,
    dictionary: Array.isArray(source.dictionary)
      ? source.dictionary.filter((word) => typeof word === "string" && word.trim()).slice(0, 800)
      : [],
    replacements: Array.isArray(source.replacements) ? source.replacements : [],
    customInstructions: typeof source.customInstructions === "string" ? source.customInstructions : "",
  };
}

function shouldApplyCustomizationRevision(currentRevision, incomingRevision) {
  if (!Number.isFinite(incomingRevision)) return !Number.isFinite(currentRevision);
  if (!Number.isFinite(currentRevision)) return true;
  return incomingRevision >= currentRevision;
}

function persistTranscriptCustomizations(document) {
  const config = readAquaSettings();
  const currentRevision = Number(config._aquaOmarchyCustomizationRevision);
  if (!shouldApplyCustomizationRevision(currentRevision, document.revision)) return config;
  config.dictionary = document.dictionary;
  config.replacements = document.replacements;
  config.customInstructions = document.customInstructions;
  if (Number.isFinite(document.revision)) config._aquaOmarchyCustomizationRevision = document.revision;
  config._aquaOmarchyCustomizationSyncedAt = new Date().toISOString();
  atomicWrite(settingsPath, config);
  return config;
}

async function requestTranscriptCustomizations(body) {
  const config = readAquaSettings();
  const token = readAquaToken(config);
  if (!token) throw new Error("Aqua login token is missing");
  const response = await fetch(customizationsUrl, {
    method: body ? "POST" : "GET",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Aqua dictionary request failed (${response.status})`);
  const source = payload?.customizations || payload;
  if (!Array.isArray(source.dictionary) || !Array.isArray(source.replacements) || typeof source.customInstructions !== "string") {
    throw new Error("Aqua returned an incomplete personalization document; saved settings were kept");
  }
  const document = normalizeTranscriptCustomizations(payload);
  persistTranscriptCustomizations(document);
  return document;
}

async function refreshTranscriptCustomizations() {
  return requestTranscriptCustomizations();
}

async function probeTranscriptCustomizations(fetcher = fetch) {
  const config = readAquaSettings();
  const token = readAquaToken(config);
  if (!token) return false;
  const response = await fetcher(customizationsUrl, {
    method: "HEAD", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Aqua personalization revision check failed (${response.status})`);
  const header = response.headers.get("X-Transcript-Customizations-Revision");
  if (header === null || !/^\d+$/.test(header)) return false;
  const incoming = Number(header);
  const stored = config._aquaOmarchyCustomizationRevision;
  if (Number.isSafeInteger(incoming) && (!Number.isFinite(stored) || incoming > stored)) {
    await refreshTranscriptCustomizations();
    return true;
  }
  return false;
}

async function applyDictionaryOperation(type, input) {
  const word = String(input || "").trim();
  if (!word || word.length > 100 || /[\r\n]/.test(word)) {
    throw new Error("dictionary words and phrases must be 1 to 100 characters on one line");
  }
  if (type !== "dictionary_add" && type !== "dictionary_remove") throw new Error("invalid dictionary operation");
  return requestTranscriptCustomizations({ operation: { type, word } });
}

// Send exactly the narrow mutation shapes used by Aqua's settings sync queue.
function customizationRequest(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid personalization action");
  const nonempty = (value) => {
    if (typeof value !== "string" || !value.trim()) throw new Error("Replacement text must not be empty");
    return value.trim();
  };
  if (input.type === "custom_instructions") {
    if (typeof input.text !== "string") throw new Error("Instructions must be text");
    if (Buffer.byteLength(input.text, "utf8") > 100000) throw new Error("Instructions are too large");
    return { customizations: { customInstructions: input.text } };
  }
  if (input.type === "replacement_remove") return { operation: { type: input.type, from: nonempty(input.from) } };
  if (input.type !== "replacement_upsert") throw new Error("Unsupported personalization action");
  const replacement = { from: nonempty(input.replacement?.from), to: nonempty(input.replacement?.to) };
  for (const key of ["preserveCase", "neverAddPunctuation"]) {
    if (input.replacement[key] !== undefined) {
      if (typeof input.replacement[key] !== "boolean") throw new Error(`${key} must be true or false`);
      replacement[key] = input.replacement[key];
    }
  }
  return { operation: { type: input.type, replacement, ...(input.oldFrom ? { oldFrom: nonempty(input.oldFrom) } : {}) } };
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const previousMode = (() => {
    try { return statSync(path).mode & 0o777; } catch { return 0o600; }
  })();
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: previousMode });
  chmodSync(temporary, previousMode);
  renameSync(temporary, path);
}

function setSetting(key, value) {
  const config = readAquaSettings();
  if (booleanSettings.has(key)) {
    if (value !== "true" && value !== "false") throw new Error(`${key} must be true or false`);
    config[key] = value === "true";
    if (key === "privacyMode" && config[key]) config.memory = false;
    if (key === "memory" && config[key]) config.privacyMode = false;
  } else if (key === "language") {
    if (!supportedLanguageCodes.includes(value)) throw new Error("unsupported Aqua language");
    config.savedLanguages = [...new Set([...(Array.isArray(config.savedLanguages) ? config.savedLanguages : []), value])];
    config.language = value;
  } else {
    throw new Error(`setting is not supported by the direct client: ${key}`);
  }
  atomicWrite(settingsPath, config);
  return publicSettings(config);
}

function toggleSetting(key) {
  if (!booleanSettings.has(key)) throw new Error(`setting is not toggleable: ${key}`);
  const config = readAquaSettings();
  return setSetting(key, config[key] === true ? "false" : "true");
}

function readHistory() {
  const history = readJson(historyPath, []);
  if (!Array.isArray(history)) return [];
  return history
    .filter((entry) => entry && typeof entry.text === "string")
    .slice(0, 20);
}

function appendHistoryEntry(entry) {
  const history = [{
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    text: String(entry.text),
    audioMs: Number(entry.audioMs || 0),
    latencyMs: Number(entry.latencyMs || 0),
    targetClass: String(entry.targetClass || ""),
  }, ...readHistory()].slice(0, 20);
  atomicWrite(historyPath, history);
  return history;
}

function clearHistory() {
  atomicWrite(historyPath, []);
  return [];
}

function output(value, ok = true) {
  console.log(JSON.stringify({ ok, settings: publicSettings(), history: readHistory(), ...value }));
}

export {
  probeTranscriptCustomizations,
  requestTranscriptCustomizations,
  customizationRequest,
  appendHistoryEntry,
  applyDictionaryOperation,
  clearAccountMetadata,
  clearAquaToken,
  clearHistory,
  normalizeTranscriptCustomizations,
  publicSettings,
  readAccountMetadata,
  readAquaSettings,
  readAquaToken,
  readHistory,
  readKeyringToken,
  refreshTranscriptCustomizations,
  setSetting,
  shouldApplyCustomizationRevision,
  storeAquaToken,
  toggleSetting,
  writeAccountMetadata,
};

if (import.meta.main) {
  try {
    const command = process.argv[2] || "status";
    if (command === "status") output({});
    else if (command === "set") output({ settings: setSetting(process.argv[3], process.argv[4]) });
    else if (command === "toggle") output({ settings: toggleSetting(process.argv[3]) });
    else if (command === "clear-history") output({ history: clearHistory() });
    else if (command === "probe-customizations") {
      await probeTranscriptCustomizations();
      output({});
    }
    else if (command === "sync-customizations") {
      await refreshTranscriptCustomizations();
      output({});
    } else if (command === "dictionary-add" || command === "dictionary-remove") {
      const input = await Bun.stdin.text();
      await applyDictionaryOperation(command === "dictionary-add" ? "dictionary_add" : "dictionary_remove", input);
      output({});
    }
    else throw new Error(`unknown settings command: ${command}`);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
