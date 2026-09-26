#include <gio/gio.h>
#include <string.h>

#define APP_ID "io.github.FrankIII.AquaVoice.Login"

typedef struct {
  GApplication *app;
  GSubprocess *child;
  guint timeout;
} Delivery;
static gboolean busy = FALSE;

// Diagnostic state contains no URI, credential, account identity, or server response.
static void record_status(const gchar *state) {
  gchar *dir = g_build_filename(g_get_user_state_dir(), "aqua-voice", NULL);
  if (g_mkdir_with_parents(dir, 0700) == 0) {
    gchar *path = g_build_filename(dir, "login-callback.json", NULL);
    gchar *body = g_strdup_printf("{\"state\":\"%s\",\"updatedAt\":%" G_GINT64_FORMAT "}\n", state, g_get_real_time() / G_USEC_PER_SEC);
    g_file_set_contents_full(path, body, -1, G_FILE_SET_CONTENTS_CONSISTENT, 0600, NULL);
    g_free(body); g_free(path);
  }
  g_free(dir);
}

static gboolean expire(gpointer data) {
  Delivery *delivery = data;
  delivery->timeout = 0;
  g_subprocess_force_exit(delivery->child);
  return G_SOURCE_REMOVE;
}

static void delivered(GObject *object, GAsyncResult *result, gpointer data) {
  Delivery *delivery = data;
  GError *error = NULL;
  gboolean ok = g_subprocess_communicate_utf8_finish(G_SUBPROCESS(object), result, NULL, NULL, &error);
  if (delivery->timeout) g_source_remove(delivery->timeout);
  record_status(ok && g_subprocess_get_successful(delivery->child) ? "complete" : "failed");
  if (!ok || !g_subprocess_get_successful(delivery->child))
    g_printerr("Aqua login could not complete. Check the keyring and sign in again.\n");
  if (ok && g_subprocess_get_successful(delivery->child)) g_message("Aqua login completed");
  g_clear_error(&error);
  g_object_unref(delivery->child);
  busy = FALSE;
  g_application_release(delivery->app);
  g_free(delivery);
}

static void open_uris(GApplication *app, GFile **files, gint count, const gchar *hint, gpointer data) {
  (void)hint; (void)data;
  if (busy || count != 1) return;
  gchar *uri = g_file_get_uri(files[0]);
  if (!g_str_has_prefix(uri, "aquavoice://token=") || strlen(uri) > 8300 || strpbrk(uri, "\r\n")) {
    g_printerr("Invalid Aqua login callback.\n");
    g_free(uri);
    return;
  }
  gchar *runtime = g_build_filename(g_get_home_dir(), ".local", "lib", "aqua-voice", "runtime", NULL);
  gchar *auth = g_build_filename(g_get_home_dir(), ".local", "lib", "aqua-voice", "aqua-auth.js", NULL);
  GError *error = NULL;
  GSubprocess *child = g_subprocess_new(G_SUBPROCESS_FLAGS_STDIN_PIPE |
      G_SUBPROCESS_FLAGS_STDOUT_SILENCE | G_SUBPROCESS_FLAGS_STDERR_SILENCE,
      &error, runtime, auth, "callback-stdin", NULL);
  g_free(runtime); g_free(auth);
  if (!child) {
    g_printerr("Could not start the Aqua login handler. Run setup again.\n");
    g_clear_error(&error); g_free(uri); return;
  }
  record_status("received");
  g_message("Aqua login callback received via D-Bus");
  busy = TRUE;
  Delivery *delivery = g_new0(Delivery, 1);
  delivery->app = app; delivery->child = child;
  g_application_hold(app);
  delivery->timeout = g_timeout_add_seconds(120, expire, delivery);
  g_subprocess_communicate_utf8_async(child, uri, NULL, delivered, delivery);
  g_free(uri);
}

static void activate(GApplication *app, gpointer data) {
  (void)app; (void)data;
  record_status("unsupported-launcher");
  g_printerr("Open Aqua login links through a D-Bus-capable desktop launcher.\n");
}

static int refresh_registration(const gchar *restore) {
  GError *error = NULL;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) { g_clear_error(&error); return 1; }
  if (!restore) {
    GVariant *loaded = g_dbus_connection_call_sync(bus, "org.freedesktop.DBus",
        "/org/freedesktop/DBus", "org.freedesktop.DBus", "ReloadConfig", NULL,
        NULL, G_DBUS_CALL_FLAGS_NONE, 5000, NULL, &error);
    if (!loaded) { g_clear_error(&error); g_object_unref(bus); return 1; }
    g_variant_unref(loaded);
  }
  const gchar *name = "org.freedesktop.impl.portal.PermissionStore";
  const gchar *path = "/org/freedesktop/impl/portal/PermissionStore";
  GVariant *reply = g_dbus_connection_call_sync(bus, name, path, name, "Lookup",
      g_variant_new("(ss)", "desktop-used-apps", "x-scheme-handler/aquavoice"),
      NULL, G_DBUS_CALL_FLAGS_NONE, 5000, NULL, &error);
  // No portal preference exists on a fresh profile, and some desktops have no portal.
  if (!reply) { g_clear_error(&error); g_object_unref(bus); return 0; }
  GVariant *entries = g_variant_get_child_value(reply, 0);
  GVariantIter iter;
  g_variant_iter_init(&iter, entries);
  gchar *origin;
  GVariant *values;
  int status = 0;
  while (g_variant_iter_next(&iter, "{s@as}", &origin, &values)) {
    gsize count;
    gchar **permissions = g_variant_dup_strv(values, &count);
    const gchar *from = restore ? APP_ID : "aqua-voice-callback";
    const gchar *to = restore ? restore : APP_ID;
    if (count && strcmp(permissions[0], from) == 0) {
      g_free(permissions[0]); permissions[0] = g_strdup(to);
      GVariant *updated = g_dbus_connection_call_sync(bus, name, path, name,
          "SetPermission", g_variant_new("(sbss^as)", "desktop-used-apps", FALSE,
            "x-scheme-handler/aquavoice", origin, permissions),
          NULL, G_DBUS_CALL_FLAGS_NONE, 5000, NULL, &error);
      if (updated) g_variant_unref(updated);
      else { status = 1; g_clear_error(&error); }
    }
    g_strfreev(permissions); g_variant_unref(values); g_free(origin);
  }
  g_variant_unref(entries); g_variant_unref(reply); g_object_unref(bus);
  return status;
}

static int prepare_login(void) {
  if (refresh_registration(NULL) != 0) return 1;
  GError *error = NULL;
  GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SESSION, NULL, &error);
  if (!bus) { g_clear_error(&error); return 1; }
  GVariant *reply = g_dbus_connection_call_sync(bus, "org.freedesktop.portal.Desktop",
      "/org/freedesktop/portal/desktop", "org.freedesktop.DBus.Properties", "Get",
      g_variant_new("(ss)", "org.freedesktop.portal.OpenURI", "version"),
      G_VARIANT_TYPE("(v)"), G_DBUS_CALL_FLAGS_NONE, 5000, NULL, &error);
  gboolean available = reply != NULL;
  if (reply) g_variant_unref(reply);
  g_clear_error(&error); g_object_unref(bus);
  if (!available) g_printerr("Desktop portal unavailable. Start xdg-desktop-portal before signing in.\n");
  return available ? 0 : 1;
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--prepare-login") == 0) return prepare_login();
  if (argc == 2 && strcmp(argv[1], "--refresh-registration") == 0)
    return refresh_registration(NULL);
  if (argc == 3 && strcmp(argv[1], "--restore-portal") == 0) {
    for (const gchar *p = argv[2]; *p; p++)
      if (!g_ascii_isalnum(*p) && *p != '.' && *p != '_' && *p != '-') return 2;
    return refresh_registration(argv[2]);
  }
  // Never accept a callback through argv, including an unsupported launcher fallback.
  if (argc != 1 && !(argc == 2 && strcmp(argv[1], "--gapplication-service") == 0)) {
    g_printerr("Aqua login callbacks must be delivered through D-Bus.\n");
    return 2;
  }
  GApplication *app = g_application_new(APP_ID, G_APPLICATION_HANDLES_OPEN);
  g_application_set_inactivity_timeout(app, 10000);
  g_signal_connect(app, "open", G_CALLBACK(open_uris), NULL);
  g_signal_connect(app, "activate", G_CALLBACK(activate), NULL);
  int status = g_application_run(app, argc, argv);
  g_object_unref(app);
  return status;
}
