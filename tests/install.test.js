import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("clean staged installation works without Bun on the desktop PATH", () => {
  const home = mkdtempSync(join(tmpdir(), "aqua-install-"));
  const env = { ...process.env, HOME: home, AQUA_SETTINGS_PATH: join(home, "settings.json"), AQUA_HISTORY_PATH: join(home, "history.json"), AQUA_ACCOUNT_PATH: join(home, "account.json"), AQUA_HOTKEY_PATH: join(home, "hotkey.json"), AQUA_VOICE_TOKEN: "", DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent-aqua-test" };
  try {
    const install = Bun.spawnSync(["bash", resolve("install.sh"), "--stage-only"], { env });
    expect(install.stderr.toString()).toBe("");
    expect(install.exitCode).toBe(0);
    const desktopEnv = { ...env, PATH: "/usr/bin:/bin" };
    const control = join(home, ".local/bin/aqua-voice-control");
    const result = Bun.spawnSync([control, "settings", "status"], { env: desktopEnv });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const settings = JSON.parse(result.stdout.toString()).settings;
    expect(settings.language).toBe("en");
    expect(settings.transcriptionModel).toBe("avalon-v1.1");
    expect(settings.dictionary).toEqual([]);
    expect(settings.customInstructions).toBe("");
    expect(settings.supportedLanguages.length).toBeGreaterThan(40);
    const version = JSON.parse(readFileSync("manifest.json", "utf8")).version;
    const module = join(home, ".local/lib/aqua-voice/aqua-bridge");
    const runtime = join(home, ".local/lib/aqua-voice/runtime");
    const inspect = Bun.spawnSync([runtime, "--eval", `import {startPayload} from ${JSON.stringify(module)}; console.log(JSON.stringify(startPayload({},null)));`], { env: desktopEnv });
    expect(inspect.exitCode).toBe(0);
    const start = JSON.parse(inspect.stdout.toString());
    expect(start.metadata.version).toBe(version);
    expect(start.metadata.client).toBe("linux");
    expect(start.transcription_model).toBe("avalon-v1.1");
    expect(existsSync(join(home, ".local/lib/aqua-voice/aqua-hotkey-capture"))).toBe(true);
    expect(readFileSync(join(home, ".config/systemd/user/aqua-voice.service"), "utf8")).toContain("aqua-voice/runtime");
    expect(existsSync(join(home, ".config/hypr/bindings.lua"))).toBe(false);
    const incomplete = Bun.spawnSync([control, "status"], {env:desktopEnv});
    expect(JSON.parse(incomplete.stdout.toString()).setupRequired).toBe(true);

  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("updater preserves origin from both a source checkout and installed checkout", () => {
  const home = mkdtempSync(join(tmpdir(), "aqua-update-"));
  const source = join(home, "source");
  const plugin = join(home, ".config/omarchy/plugins/frankmi.aqua-voice");
  const fakeBin = join(home, "tools");
  const fs = require("node:fs");
  const command = (args, env = process.env) => {
    const result = Bun.spawnSync(args, { env });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  try {
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(join(home, ".config/omarchy/plugins"), { recursive: true });
    fs.copyFileSync("update.sh", join(source, "update.sh"));
    fs.writeFileSync(join(source, "install.sh"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
    for (const name of ["bun", "omarchy", "systemctl"]) fs.writeFileSync(join(fakeBin, name), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(join(fakeBin, "aqua-voice-control"), '#!/bin/bash\necho \'{"version":"test","phase":"idle"}\'\n', { mode: 0o755 });
    command(["git", "init", "-b", "main", source]);
    command(["git", "-C", source, "config", "user.email", "test@example.invalid"]);
    command(["git", "-C", source, "config", "user.name", "Test"]);
    command(["git", "-C", source, "add", "."]);
    command(["git", "-C", source, "commit", "-m", "Initial"]);
    command(["git", "clone", source, plugin]);
    const original = command(["git", "-C", plugin, "remote", "get-url", "origin"]);
    fs.writeFileSync(join(source, "change.txt"), "new version\n");
    command(["git", "-C", source, "add", "."]);
    command(["git", "-C", source, "commit", "-m", "Update"]);
    const env = { ...process.env, HOME: home, PATH: fakeBin + ":" + process.env.PATH };
    command(["bash", join(source, "update.sh")], env);
    expect(command(["git", "-C", plugin, "rev-parse", "HEAD"])).toBe(command(["git", "-C", source, "rev-parse", "HEAD"]));
    expect(command(["git", "-C", plugin, "remote", "get-url", "origin"])).toBe(original);
    command(["bash", join(plugin, "update.sh")], env);
    expect(command(["git", "-C", plugin, "remote", "get-url", "origin"])).toBe(original);
  } finally { rmSync(home, { recursive: true, force: true }); }
});


test("fresh plugin status explains setup without Bun or jq", () => {
  const home = mkdtempSync(join(tmpdir(), "aqua-first-run-"));
  try {
    const result = Bun.spawnSync(["/bin/bash", resolve("bin/aqua-voice-control"), "status"], {
      env: { HOME: home, PATH: "/nonexistent" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(JSON.parse(result.stdout.toString())).toMatchObject({setupRequired:true,phase:"offline",ok:true});
  } finally { rmSync(home, {recursive:true,force:true}); }
});
