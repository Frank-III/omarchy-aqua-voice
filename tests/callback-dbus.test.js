import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("desktop activation transports callback through D-Bus and stdin, never argv", async () => {
  const home = mkdtempSync(join(tmpdir(), "aqua-dbus-"));
  const data = join(home, ".local/share");
  const env = {...process.env, HOME:home, XDG_DATA_HOME:data, XDG_STATE_HOME:join(home,".local/state")};
  try {
    const setup = Bun.spawnSync(["bash", resolve("install.sh"), "--stage-only"], {env});
    expect(setup.exitCode).toBe(0);
    const prefix = join(home, ".local/lib/aqua-voice");
    const desktop = join(data, "applications/io.github.FrankIII.AquaVoice.Login.desktop");
    const text = readFileSync(desktop,"utf8");
    expect(text).toContain("DBusActivatable=true");
    expect(text).not.toMatch(/%[uUfF]/);
    expect(text).not.toMatch(/^Exec=/m);
    // A fake auth receiver holds the pipe open so the test can inspect process arguments.
    writeFileSync(join(prefix,"runtime"), `#!/bin/bash
printf '%s\\n' "$@" > "$HOME/auth-argv"
printf '%s' "$$" > "$HOME/auth-pid"
cat > "$HOME/received"
sleep 1
`, {mode:0o755});
    const sender = join(home,"sender.c");
    writeFileSync(sender, `#include <gio/gdesktopappinfo.h>
#include <stdio.h>
static gboolean done(gpointer data) {g_main_loop_quit(data);return G_SOURCE_REMOVE;}
int main(int argc,char **argv) {
  if(argc!=2)return 2;
  char uri[8500]; if(!fgets(uri,sizeof(uri),stdin))return 3;
  GDesktopAppInfo *app=g_desktop_app_info_new_from_filename(argv[1]);
  if(!app)return 4;
  GList *uris=g_list_append(NULL,uri); GError *error=NULL;
  gboolean ok=g_app_info_launch_uris(G_APP_INFO(app),uris,NULL,&error);
  GMainLoop *loop=g_main_loop_new(NULL,FALSE);g_timeout_add(500,done,loop);g_main_loop_run(loop);g_main_loop_unref(loop);
  g_list_free(uris);g_object_unref(app);
  if(error)g_error_free(error);
  return ok?0:5;
}`);
    const flags = Bun.spawnSync(["pkg-config","--cflags","--libs","gio-unix-2.0"]).stdout.toString().trim().split(/\s+/);
    const compiled = Bun.spawnSync(["cc",sender,"-o",join(home,"sender"),...flags]);
    expect(compiled.exitCode).toBe(0);
    const sentinel="aquavoice://token=TestOnly-Upper.Case_123/";
    const driver=join(home,"driver.mjs");
    writeFileSync(driver, `
      import {readFileSync,readdirSync,existsSync} from 'node:fs';
      const home=process.env.HOME;
      const sentinel=${JSON.stringify(sentinel)};
      const sent=Bun.spawnSync([home+'/sender',home+'/.local/share/applications/io.github.FrankIII.AquaVoice.Login.desktop'],{stdin:Buffer.from(sentinel)});
      if(sent.exitCode!==0)throw new Error('GIO launch failed');
      const until=Date.now()+7000;
      while(!existsSync(home+'/received') && Date.now()<until)await Bun.sleep(20);
      if(readFileSync(home+'/received','utf8')!==sentinel)throw new Error('Callback mismatch');
      for(const pid of readdirSync('/proc').filter(x=>/^\\d+$/.test(x))) {
        try {
          const cmd=readFileSync('/proc/'+pid+'/cmdline','utf8');
          if(cmd.includes(home)&&cmd.includes(sentinel))throw new Error('Credential in argv');
        }catch(e){if(e.message==='Credential in argv')throw e;}
      }
      if(readFileSync(home+'/auth-argv','utf8').includes(sentinel))throw new Error('Credential forwarded in argv');
      console.log('Secure callback delivered');
    `);
    const child=Bun.spawn(["dbus-run-session","--",process.execPath,driver],{env,stdout:"pipe",stderr:"pipe"});
    const output=new Response(child.stdout).text();const errors=new Response(child.stderr).text();
    const code=await child.exited;
    const out=await output; const err=await errors;
    expect(err).not.toContain(sentinel);
    expect(out).not.toContain(sentinel);
    expect(code).toBe(0);
    expect(out).toContain("Secure callback delivered");
  } finally { rmSync(home,{recursive:true,force:true}); }
},15000);
