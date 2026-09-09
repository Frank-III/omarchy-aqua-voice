import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("handler replacement requires opt-in and restoration preserves a later user choice", () => {
  const home=mkdtempSync(join(tmpdir(),"aqua-handler-"));
  const bin=join(home,"bin");mkdirSync(bin);
  const current=join(home,"handler");writeFileSync(current,"other.desktop\n");
  writeFileSync(join(bin,"xdg-mime"),'#!/bin/bash\nif [[ "$1" == query ]]; then cat "$TEST_HANDLER"; else printf "%s\\n" "$2" > "$TEST_HANDLER"; fi\n',{mode:0o755});
  const run=(...args)=>Bun.spawnSync(["bash",resolve("bin/aqua-login-handler"),...args],{env:{...process.env,HOME:home,PATH:bin+":"+process.env.PATH,TEST_HANDLER:current}});
  try {
    expect(run("claim").exitCode).toBe(0);
    expect(readFileSync(current,"utf8")).toBe("other.desktop\n");
    expect(run("claim","--replace").exitCode).toBe(0);
    expect(readFileSync(current,"utf8")).toBe("aqua-voice-callback.desktop\n");
    expect(run("claim","--replace").exitCode).toBe(0);
    expect(run("restore").exitCode).toBe(0);
    expect(readFileSync(current,"utf8")).toBe("other.desktop\n");
    run("claim","--replace");writeFileSync(current,"new-choice.desktop\n");
    run("restore");
    expect(readFileSync(current,"utf8")).toBe("new-choice.desktop\n");
  } finally {rmSync(home,{recursive:true,force:true});}
});

test("settings import preserves the source, strips tokens, and refuses to replace existing preferences", () => {
  const home=mkdtempSync(join(tmpdir(),"aqua-import-"));
  const legacy=join(home,"previous.json");const destination=join(home,"own.json");
  const original=JSON.stringify({language:"ja",privacyMode:true,token:"test-only-secret"});
  writeFileSync(legacy,original);
  const script=`import {readExistingSettings,importExistingSettings} from ${JSON.stringify(resolve("bin/aqua-settings.js"))}; importExistingSettings(readExistingSettings());`;
  const run=()=>Bun.spawnSync([process.execPath,"--eval",script],{env:{...process.env,HOME:home,AQUA_LEGACY_SETTINGS_PATH:legacy,AQUA_SETTINGS_PATH:destination}});
  try {
    expect(run().exitCode).toBe(0);
    expect(readFileSync(legacy,"utf8")).toBe(original);
    expect(JSON.parse(readFileSync(destination,"utf8"))).toEqual({language:"ja",privacyMode:true});
    expect(run().exitCode).toBe(1);
    expect(readFileSync(legacy,"utf8")).toBe(original);
  } finally {rmSync(home,{recursive:true,force:true});}
});

test("noninteractive installation requires explicit setup acceptance before writes", () => {
  const home=mkdtempSync(join(tmpdir(),"aqua-consent-"));
  try {
    const result=Bun.spawnSync(["bash",resolve("install.sh")],{env:{...process.env,HOME:home},stdin:"ignore"});
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("--accept-setup");
    expect(existsSync(join(home,".local/lib/aqua-voice"))).toBe(false);
  } finally {rmSync(home,{recursive:true,force:true});}
});

test("default settings writes use the plugin directory, leaving previous Aqua files untouched", () => {
  const home=mkdtempSync(join(tmpdir(),"aqua-separate-settings-"));
  mkdirSync(join(home,".config/Aqua Voice"),{recursive:true});
  const legacy=join(home,".config/Aqua Voice/settings.json");writeFileSync(legacy,'{"language":"ja"}');
  try {
    const env={...process.env,HOME:home};delete env.AQUA_SETTINGS_PATH;
    const result=Bun.spawnSync([process.execPath,"--eval",`import {setSetting} from ${JSON.stringify(resolve("bin/aqua-settings.js"))};setSetting("language","fr");`],{env});
    expect(result.exitCode).toBe(0);
    expect(readFileSync(legacy,"utf8")).toBe('{"language":"ja"}');
    expect(JSON.parse(readFileSync(join(home,".config/aqua-voice/settings.json"),"utf8")).language).toBe("fr");
  } finally {rmSync(home,{recursive:true,force:true});}
});
