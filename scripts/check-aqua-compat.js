#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.argv[2] || "");
const mainPath = resolve(root, ".webpack/main/index.js");
const rendererPath = resolve(root, ".webpack/renderer/main_window/index.js");
const packagePath = resolve(root, "package.json");

if (!process.argv[2] || !existsSync(mainPath) || !existsSync(rendererPath)) {
  console.error("usage: check-aqua-compat.js <extracted Aqua app directory>");
  process.exit(2);
}

const [main, renderer, packageText] = await Promise.all([
  Bun.file(mainPath).text(),
  Bun.file(rendererPath).text(),
  existsSync(packagePath) ? Bun.file(packagePath).text() : "{}",
]);

const checks = [
  ["realtime WebSocket", main, "wss://realtime.aquavoice.com"],
  ["PCM audio format", renderer, 'audio_format:"pcm_s16le"'],
  ["stop request", renderer, 'type:"stop_request"'],
  ["annotated document text", renderer, "display_text_annotated"],
  ["dictionary endpoint", main, "/users/transcript-customizations/"],
  ["profile validation", main, "users/profile/"],
  ["desktop sign-in", renderer, "/sign-in?origin="],
  ["Aqua callback scheme", main, 'PROTOCOL_NAME||"aquavoice"'],
  ["token callback", main, '://token`'],
].map(([name, source, anchor]) => ({ name, found: source.includes(anchor) }));

const missing = checks.filter((check) => !check.found).map((check) => check.name);
let version = "unknown";
try { version = JSON.parse(packageText).version || version; } catch {}

console.log(JSON.stringify({
  compatible: missing.length === 0,
  aquaVersion: version,
  checks,
  missing,
}, null, 2));

if (missing.length) process.exitCode = 1;
