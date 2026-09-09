import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "aqua-auth-test-"));
  const tools = join(dir, "bin");
  mkdirSync(tools);
  const settings = join(dir, "settings.json");
  writeFileSync(settings, JSON.stringify({ token: "legacy-test-token", language: "en" }));
  writeFileSync(join(tools, "secret-tool"), `#!/bin/bash
case "$1" in
 store) [[ "\${TEST_KEYRING_FAIL:-}" != 1 ]] || exit 1; cat > "$TEST_DIR/keyring" ;;
 lookup) [[ -f "$TEST_DIR/keyring" ]] && cat "$TEST_DIR/keyring" ;;
 clear) [[ "\${TEST_KEYRING_FAIL:-}" != 1 ]] || exit 1; rm -f "$TEST_DIR/keyring" ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(tools, "systemctl"), '#!/bin/bash\n[[ "${TEST_RESTART_FAIL:-}" != 1 ]] || exit 1\ntouch "$TEST_DIR/restarted"\n', { mode: 0o755 });
  writeFileSync(join(tools, "xdg-open"), '#!/bin/bash\n[[ "${TEST_BROWSER_FAIL:-}" != 1 ]] || exit 1\nprintf "%s" "$1" > "$TEST_DIR/opened-url"\n', { mode: 0o755 });
  const preload = join(dir, "mock.js");
  writeFileSync(preload, `globalThis.fetch = async (url, options) => {
    if (url !== "https://core.aquavoice.com/users/profile/") throw new Error("Unexpected endpoint");
    if (options.headers.Authorization !== "Bearer new-test-token") throw new Error("Unexpected token");
    const status = Number(process.env.TEST_PROFILE_STATUS || 200);
    return Response.json(process.env.TEST_BAD_PROFILE ? {} : {email:"test@example.invalid",name:"Test",plan_type:"pro"}, {status});
  };`);
  const env = { ...process.env, HOME: dir, TEST_DIR: dir, AQUA_VOICE_TOKEN: "", AQUA_SETTINGS_PATH: settings, AQUA_ACCOUNT_PATH: join(dir, "account.json"), AQUA_HISTORY_PATH: join(dir, "history.json"), PATH: tools + ":" + process.env.PATH };
  const command = (args, overrides = {}, input) => Bun.spawnSync([process.execPath, "--preload", preload, resolve("bin/aqua-auth.js"), ...args], { env: { ...env, ...overrides }, stdin: input === undefined ? "ignore" : Buffer.from(input) });
  try { run({dir,settings,command}); } finally { rmSync(dir, { recursive:true,force:true }); }
}

test("login callback validates, saves to keyring, removes legacy token, then restarts", () => fixture(({dir,settings,command}) => {
  const result = command(["callback-stdin"], {}, "aquavoice://token=new-test-token/");
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).connected).toBe(true);
  expect(result.stdout.toString()).not.toContain("new-test-token");
  expect(readFileSync(join(dir,"keyring"),"utf8")).toBe("new-test-token");
  expect(JSON.parse(readFileSync(settings,"utf8")).token).toBe("");
  expect(existsSync(join(dir,"restarted"))).toBe(true);
}));

for (const [label,env] of [["unauthorized",{TEST_PROFILE_STATUS:"401"}],["malformed profile",{TEST_BAD_PROFILE:"1"}],["locked keyring",{TEST_KEYRING_FAIL:"1"}]]) {
  test(`callback rejects ${label} without erasing existing credentials`, () => fixture(({dir,settings,command}) => {
    const result = command(["callback-stdin"], env, "aquavoice://token=new-test-token/");
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(readFileSync(settings,"utf8")).token).toBe("legacy-test-token");
    expect(existsSync(join(dir,"restarted"))).toBe(false);
    expect(result.stderr.toString()).not.toContain("new-test-token");
  }));
}

test("login reports browser launch failure", () => fixture(({command}) => {
  expect(command(["login"],{TEST_BROWSER_FAIL:"1"}).exitCode).toBe(1);
  expect(command(["login"]).exitCode).toBe(0);
}));

test("callback reports backend restart failure after credential storage", () => fixture(({command}) => {
  const result = command(["callback-stdin"], {TEST_RESTART_FAIL:"1"}, "aquavoice://token=new-test-token/");
  expect(result.exitCode).toBe(1);
  expect(JSON.parse(result.stderr).error).toContain("could not restart");
}));

test("sign-out does not claim success when keyring removal fails", () => fixture(({dir,settings,command}) => {
  writeFileSync(join(dir,"keyring"),"new-test-token");
  expect(command(["logout"],{TEST_KEYRING_FAIL:"1"}).exitCode).toBe(1);
  expect(readFileSync(join(dir,"keyring"),"utf8")).toBe("new-test-token");
  expect(existsSync(join(dir,"restarted"))).toBe(false);
  expect(command(["logout"]).exitCode).toBe(0);
  expect(existsSync(join(dir,"keyring"))).toBe(false);
  expect(JSON.parse(readFileSync(settings,"utf8")).token).toBe("");
}));
