import {test,expect} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";

test("offline history and account metadata reach jq only over stdin",()=>{
 const home=mkdtempSync(join(tmpdir(),"aqua-offline-status-"));
 try {
  const prefix=join(home,".local/lib/aqua-voice");mkdirSync(prefix,{recursive:true});
  writeFileSync(join(prefix,".setup-complete"),"");
  writeFileSync(join(prefix,"runtime"),'#!/bin/bash\nexec '+JSON.stringify(process.execPath)+' "$@"\n',{mode:0o755});
  const snapshot={settings:{language:"en"},history:[{text:"PRIVATE_DICTATION_SENTINEL"}]};
  const account={email:"PRIVATE_ACCOUNT_SENTINEL"};
  writeFileSync(join(prefix,"aqua-bridge"),'process.exit(1);');
  writeFileSync(join(prefix,"aqua-settings.js"),'console.log('+JSON.stringify(JSON.stringify(snapshot))+');');
  writeFileSync(join(prefix,"aqua-auth.js"),'console.log('+JSON.stringify(JSON.stringify({connected:true,account}))+');');
  writeFileSync(join(prefix,"aqua-hotkey.js"),'console.log(JSON.stringify({hotkey:{display:"Alt+Shift+F23"}}));');
  const tools=join(home,"tools");mkdirSync(tools);
  writeFileSync(join(tools,"jq"),'#!/bin/bash\nprintf "%s\\n" "$@" > "$HOME/jq-argv"\nexec '+JSON.stringify(Bun.which("jq"))+' "$@"\n',{mode:0o755});
  const result=Bun.spawnSync(["bash",resolve("bin/aqua-voice-control"),"status"],{env:{HOME:home,PATH:tools+":"+process.env.PATH}});
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toBe("");
  const output=JSON.parse(result.stdout.toString());
  expect(output.phase).toBe("offline");expect(output.history).toEqual(snapshot.history);expect(output.account).toEqual(account);
  const args=readFileSync(join(home,"jq-argv"),"utf8");
  expect(args).not.toContain("PRIVATE_DICTATION_SENTINEL");expect(args).not.toContain("PRIVATE_ACCOUNT_SENTINEL");
  expect(args).not.toContain("--argjson");
 } finally {rmSync(home,{recursive:true,force:true});}
});
