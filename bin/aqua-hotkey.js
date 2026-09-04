#!/usr/bin/env bun

import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const home = process.env.HOME;
const configPath = process.env.AQUA_HOTKEY_PATH || `${home}/.config/aqua-voice/hotkey.json`;
const bindingsPath = process.env.AQUA_HYPR_BINDINGS_PATH || `${home}/.config/hypr/bindings.lua`;
const captureBinary = process.env.AQUA_HOTKEY_CAPTURE_BIN || `${import.meta.dir}/aqua-hotkey-capture`;
const modifierOrder = ["CTRL", "ALT", "SHIFT", "SUPER"];
const startMarker = "-- BEGIN AQUA VOICE HOTKEY (managed)";
const endMarker = "-- END AQUA VOICE HOTKEY (managed)";

function atomicWrite(path, content, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  const fileMode = (() => {
    try { return statSync(path).mode & 0o777; } catch { return mode; }
  })();
  writeFileSync(temporary, content, { mode: fileMode });
  chmodSync(temporary, fileMode);
  renameSync(temporary, path);
}

function readKbOptions() {
  const result = Bun.spawnSync(["hyprctl", "getoption", "input:kb_options"]);
  if (!result.success) return "";
  const match = result.stdout.toString().match(/^str:\s*(.*)$/m);
  return match ? match[1].trim() : "";
}

function normalizeModifiers(rawModifiers, kbOptions = "") {
  const raw = new Set((rawModifiers || []).map(Number));
  const swapped = kbOptions.split(",").includes("altwin:swap_alt_win");
  const ctrlOnCaps = kbOptions.split(",").includes("ctrl:nocaps");
  const logical = new Set();
  if (raw.has(29) || raw.has(97) || (ctrlOnCaps && raw.has(58))) logical.add("CTRL");
  if (raw.has(42) || raw.has(54)) logical.add("SHIFT");
  if (raw.has(56) || raw.has(100)) logical.add(swapped ? "SUPER" : "ALT");
  if (raw.has(125) || raw.has(126)) logical.add(swapped ? "ALT" : "SUPER");
  return modifierOrder.filter((modifier) => logical.has(modifier));
}

function displayModifier(modifier) {
  return modifier.charAt(0) + modifier.slice(1).toLowerCase();
}

function normalizeConfig(value) {
  const keyCode = Number(value?.keyCode);
  const keyName = String(value?.keyName || `code:${keyCode}`);
  const modifiers = modifierOrder.filter((modifier) => value?.modifiers?.includes(modifier));
  if (!Number.isInteger(keyCode) || keyCode < 1 || keyCode > 255) throw new Error("invalid hotkey key code");
  const display = [...modifiers.map(displayModifier), keyName].join("+");
  return {
    version: 1,
    keyCode,
    keyName,
    modifiers,
    display,
    hyprChord: [...modifiers, `code:${keyCode + 8}`].join(" + "),
  };
}

function defaultHotkeyConfig() {
  return normalizeConfig({ keyCode: 193, keyName: "F23", modifiers: ["SHIFT", "SUPER"] });
}

function readHotkeyConfig() {
  try { return normalizeConfig(JSON.parse(readFileSync(configPath, "utf8"))); }
  catch { return defaultHotkeyConfig(); }
}

function logicalModifiersForHeldCodes(heldCodes, kbOptions = "") {
  return normalizeModifiers([...heldCodes], kbOptions);
}

function hotkeyMatches(config, keyCode, heldCodes, kbOptions = "") {
  if (Number(keyCode) !== config.keyCode) return false;
  const active = logicalModifiersForHeldCodes(heldCodes, kbOptions);
  return active.length === config.modifiers.length
    && config.modifiers.every((modifier) => active.includes(modifier));
}

function managedBindingBlock(config) {
  return [
    startMarker,
    `-- ${config.display}; raw evdev key ${config.keyCode}, Hyprland XKB code ${config.keyCode + 8}.`,
    `hl.unbind("${config.hyprChord}")`,
    `o.bind("${config.hyprChord}", "Swallow Aqua dictation hotkey", "true")`,
    endMarker,
  ].join("\n");
}

function replaceManagedBinding(source, config) {
  const block = managedBindingBlock(config);
  const markedStart = source.indexOf(startMarker);
  const markedEnd = source.indexOf(endMarker);
  if (markedStart >= 0 && markedEnd > markedStart) {
    return source.slice(0, markedStart) + block + source.slice(markedEnd + endMarker.length);
  }

  const lines = source.split("\n");
  const bindIndex = lines.findIndex((line) => line.includes("Swallow Aqua dictation hotkey"));
  if (bindIndex >= 0) {
    let first = bindIndex;
    while (first > 0 && lines[first - 1].trim() !== ""
      && (/^\s*--/.test(lines[first - 1]) || /hl\.unbind/.test(lines[first - 1]))) first -= 1;
    lines.splice(first, bindIndex - first + 1, block);
    return lines.join("\n");
  }
  return `${source.trimEnd()}\n\n${block}\n`;
}

function writeHotkeyConfig(config) {
  atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function updateHyprlandBinding(config) {
  const source = readFileSync(bindingsPath, "utf8");
  const backup = `${bindingsPath}.aqua-voice.bak`;
  if (!existsSync(backup)) copyFileSync(bindingsPath, backup);
  const updated = replaceManagedBinding(source, config);
  if (updated !== source) atomicWrite(bindingsPath, updated, 0o644);
  return source;
}

function reloadHyprland() {
  const reload = Bun.spawnSync(["hyprctl", "reload"]);
  if (!reload.success) throw new Error("Hyprland reload failed");
  const errors = Bun.spawnSync(["hyprctl", "configerrors"]);
  const output = errors.stdout.toString().trim();
  if (!errors.success || output) throw new Error(output || "Hyprland reported a configuration error");
}

async function captureHotkey() {
  const wasActive = Bun.spawnSync(["systemctl", "--user", "is-active", "--quiet", "aqua-voice.service"]).success;
  const oldConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : null;
  const oldBindings = readFileSync(bindingsPath, "utf8");
  if (wasActive) Bun.spawnSync(["systemctl", "--user", "stop", "aqua-voice.service"]);
  try {
    const child = Bun.spawn([captureBinary], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();
    const exitCode = await child.exited;
    const result = JSON.parse((await stdoutPromise).trim() || "{}");
    if (exitCode !== 0 || !result.ok) {
      if (result.cancelled) return { ok: false, cancelled: true };
      if (result.timeout) return { ok: false, timeout: true };
      throw new Error((await stderrPromise).trim() || "hotkey capture failed");
    }

    const modifiers = normalizeModifiers(result.rawModifiers, readKbOptions());
    const safeUnmodified = result.keyCode >= 183 && result.keyCode <= 194;
    if (modifiers.length === 0 && !safeUnmodified) {
      throw new Error("use at least one modifier for ordinary keys");
    }
    const config = normalizeConfig({ keyCode: result.keyCode, keyName: result.keyName, modifiers });
    writeHotkeyConfig(config);
    updateHyprlandBinding(config);
    try {
      reloadHyprland();
    } catch (error) {
      if (oldConfig === null) writeHotkeyConfig(defaultHotkeyConfig());
      else atomicWrite(configPath, oldConfig);
      atomicWrite(bindingsPath, oldBindings, 0o644);
      Bun.spawnSync(["hyprctl", "reload"]);
      throw error;
    }
    return { ok: true, hotkey: config };
  } finally {
    if (wasActive) Bun.spawnSync(["systemctl", "--user", "start", "aqua-voice.service"]);
  }
}

async function ensureHotkey() {
  const config = readHotkeyConfig();
  if (!existsSync(configPath)) writeHotkeyConfig(config);
  updateHyprlandBinding(config);
  reloadHyprland();
  return config;
}

export {
  defaultHotkeyConfig,
  hotkeyMatches,
  normalizeConfig,
  normalizeModifiers,
  readKbOptions,
  readHotkeyConfig,
  replaceManagedBinding,
};

if (import.meta.main) {
  try {
    const command = process.argv[2] || "status";
    if (command === "status") console.log(JSON.stringify({ ok: true, hotkey: readHotkeyConfig() }));
    else if (command === "ensure") console.log(JSON.stringify({ ok: true, hotkey: await ensureHotkey() }));
    else if (command === "capture") console.log(JSON.stringify(await captureHotkey()));
    else throw new Error(`unknown hotkey command: ${command}`);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
