import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

test("registration refresh migrates only Aqua's stale portal choices and supports restoration", async () => {
  const home=mkdtempSync(join(tmpdir(),"aqua-portal-reg-"));
  try {
    const flags=Bun.spawnSync(["pkg-config","--cflags","--libs","gio-2.0"]).stdout.toString().trim().split(/\s+/);
    const helper=join(home,"callback");
    expect(Bun.spawnSync(["cc","native/aqua-login-callback.c","-o",helper,...flags]).exitCode).toBe(0);
    const mock=join(home,"mock.c");
    writeFileSync(mock, `#include <gio/gio.h>
#include <string.h>
static gchar *selected; static gboolean other_touched=FALSE;
static void save(void) {
 gchar *p=g_build_filename(g_get_home_dir(),"portal.json",NULL);
 gchar *json=g_strdup_printf("{\\"selected\\":\\"%s\\",\\"otherTouched\\":%s}",selected,other_touched?"true":"false");
 g_file_set_contents(p,json,-1,NULL);g_free(p);g_free(json);
}
static void method(GDBusConnection *c,const gchar *s,const gchar *p,const gchar *i,const gchar *m,GVariant *params,GDBusMethodInvocation *call,gpointer data) {
 (void)c;(void)s;(void)p;(void)i;(void)data;
 if(!strcmp(m,"Lookup")) {
  GVariantBuilder b;g_variant_builder_init(&b,G_VARIANT_TYPE("a{sas}"));
  const gchar *ours[]={selected,"1","3",NULL};const gchar *other[]={"another-client","4","5",NULL};
  g_variant_builder_add(&b,"{s@as}","browser",g_variant_new_strv(ours,-1));
  g_variant_builder_add(&b,"{s@as}","other-browser",g_variant_new_strv(other,-1));
  g_dbus_method_invocation_return_value(call,g_variant_new("(@a{sas}v)",g_variant_builder_end(&b),g_variant_new_byte(0)));
 } else {
  const gchar *table,*id,*origin;gboolean create;gchar **values;
  g_variant_get(params,"(&sb&s&s^as)",&table,&create,&id,&origin,&values);
  if(!strcmp(origin,"browser")){g_free(selected);selected=g_strdup(values[0]);}
  else other_touched=TRUE;
  if(strcmp(values[1],"1") || strcmp(values[2],"3")) other_touched=TRUE;
  g_strfreev(values);save();g_dbus_method_invocation_return_value(call,NULL);
 }
}
static const GDBusInterfaceVTable vtable={method,NULL,NULL,{0}};
static void acquired(GDBusConnection *c,const gchar *n,gpointer data) {
 (void)n;(void)data;
 const gchar *xml="<node><interface name='org.freedesktop.impl.portal.PermissionStore'><method name='Lookup'><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='a{sas}' direction='out'/><arg type='v' direction='out'/></method><method name='SetPermission'><arg type='s' direction='in'/><arg type='b' direction='in'/><arg type='s' direction='in'/><arg type='s' direction='in'/><arg type='as' direction='in'/></method></interface></node>";
 GDBusNodeInfo *info=g_dbus_node_info_new_for_xml(xml,NULL);
 g_dbus_connection_register_object(c,"/org/freedesktop/impl/portal/PermissionStore",info->interfaces[0],&vtable,NULL,NULL,NULL);
 g_dbus_node_info_unref(info);save();
}
int main(void){selected=g_strdup("aqua-voice-callback");g_bus_own_name(G_BUS_TYPE_SESSION,"org.freedesktop.impl.portal.PermissionStore",G_BUS_NAME_OWNER_FLAGS_NONE,acquired,NULL,NULL,NULL,NULL);g_main_loop_run(g_main_loop_new(NULL,FALSE));}
`);
    expect(Bun.spawnSync(["cc",mock,"-o",join(home,"mock"),...flags]).exitCode).toBe(0);
    const driver=join(home,"driver.mjs");
    writeFileSync(driver, `
      import {existsSync,readFileSync} from 'node:fs';
      const home=process.env.HOME;
      const server=Bun.spawn([home+'/mock']);
      try {
        const until=Date.now()+3000;
        while(!existsSync(home+'/portal.json')&&Date.now()<until)await Bun.sleep(20);
        const run=(...args)=>{if(Bun.spawnSync([home+'/callback',...args]).exitCode!==0)throw new Error('Registration failed');};
        const state=()=>JSON.parse(readFileSync(home+'/portal.json'));
        run('--refresh-registration');
        if(state().selected!=='io.github.FrankIII.AquaVoice.Login'||state().otherTouched)throw new Error('Incorrect migration');
        run('--restore-portal','prior-client');
        if(state().selected!=='prior-client'||state().otherTouched)throw new Error('Incorrect restore');
        run('--refresh-registration');
        if(state().selected!=='prior-client')throw new Error('Unrelated choice changed');
        console.log('Portal migration passed');
      } finally {server.kill();await server.exited;}
    `);
    const child=Bun.spawn(["dbus-run-session","--",process.execPath,driver],{env:{...process.env,HOME:home},stdout:"pipe",stderr:"pipe"});
    const out=new Response(child.stdout).text();const err=new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(await out).toContain('Portal migration passed');
    expect(await err).not.toContain('Error');
  } finally {rmSync(home,{recursive:true,force:true});}
},10000);
