#!/usr/bin/env bun

import {
  clearAccountMetadata,
  clearAquaToken,
  readAccountMetadata,
  readAquaSettings,
  readAquaToken,
  readKeyringToken,
  storeAquaToken,
  writeAccountMetadata,
} from "./aqua-settings.js";

const signInUrl = "https://aquavoice.com/sign-in?origin=desktop";

function parseCallbackUrl(input) {
  const value = String(input || "").trim();
  const prefix = "aquavoice://token=";
  if (!value.startsWith(prefix)) throw new Error("invalid Aqua callback URL");
  const token = decodeURIComponent(value.slice(prefix.length).replace(/\/$/, ""));
  if (!token || token.length > 8192 || /\s/.test(token)) throw new Error("invalid Aqua callback token");
  return token;
}

async function validateToken(token) {
  const response = await fetch("https://core.aquavoice.com/users/profile/", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Aqua account validation failed (${response.status})`);
  return {
    email: typeof profile.email === "string" ? profile.email : "",
    name: typeof profile.name === "string" ? profile.name : "",
    plan: String(profile.plan_type || profile.subscription?.plan_type || ""),
  };
}

function restartBackend() {
  Bun.spawnSync(["systemctl", "--user", "restart", "aqua-voice.service"]);
}

async function saveValidatedToken(token) {
  const account = await validateToken(token);
  await storeAquaToken(token);
  writeAccountMetadata(account);
  restartBackend();
  return account;
}

function safeStatus() {
  const config = readAquaSettings();
  const keyring = readKeyringToken();
  const token = keyring || readAquaToken(config, true);
  return {
    ok: true,
    connected: Boolean(token),
    storage: keyring ? "Secret Service" : (config.token ? "Legacy settings" : "None"),
    account: readAccountMetadata(),
    callbackScheme: "aquavoice://token=…",
  };
}

async function migrateLegacyToken() {
  const config = readAquaSettings();
  const keyring = readKeyringToken();
  if (keyring) {
    if (config.token) await storeAquaToken(keyring);
    if (!readAccountMetadata().validatedAt) writeAccountMetadata(await validateToken(keyring));
    return safeStatus();
  }
  const legacy = String(config.token || "").trim();
  if (!legacy) return safeStatus();
  await saveValidatedToken(legacy);
  return safeStatus();
}

export { parseCallbackUrl, safeStatus, signInUrl, validateToken };

if (import.meta.main) {
  try {
    const command = process.argv[2] || "status";
    if (command === "status") console.log(JSON.stringify(safeStatus()));
    else if (command === "login") {
      const child = Bun.spawn(["xdg-open", signInUrl], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      child.unref();
      console.log(JSON.stringify({ ok: true, opened: true }));
    } else if (command === "callback-stdin") {
      const token = parseCallbackUrl(await Bun.stdin.text());
      const account = await saveValidatedToken(token);
      console.log(JSON.stringify({ ok: true, connected: true, account }));
    } else if (command === "migrate") console.log(JSON.stringify(await migrateLegacyToken()));
    else if (command === "logout") {
      clearAquaToken();
      clearAccountMetadata();
      restartBackend();
      console.log(JSON.stringify({ ok: true, connected: false }));
    } else throw new Error(`unknown auth command: ${command}`);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
