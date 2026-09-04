import { describe, expect, test } from "bun:test";
import { audioFrame, displayText, focusIsStable, gestureDecision, isTerminalClass, isTrackedHotkeyCode, pasteCommand, pasteShortcut, shouldRetryFinalization, startPayload } from "../bin/aqua-bridge.js";
import { normalizeTranscriptCustomizations, publicSettings, shouldApplyCustomizationRevision } from "../bin/aqua-settings.js";
import { parseCallbackUrl, signInUrl } from "../bin/aqua-auth.js";
import { defaultHotkeyConfig, hotkeyMatches, normalizeModifiers, replaceManagedBinding } from "../bin/aqua-hotkey.js";

describe("Aqua realtime protocol", () => {
  test("normalizes raw Alt as Super for this machine's XKB swap", () => {
    const options = "altwin:swap_alt_win,ctrl:nocaps";
    expect(normalizeModifiers([42, 56], options)).toEqual(["SHIFT", "SUPER"]);
    expect(normalizeModifiers([42, 125], options)).toEqual(["ALT", "SHIFT"]);
    expect(normalizeModifiers([58], options)).toEqual(["CTRL"]);
  });

  test("matches only the configured chord and writes one managed binding", () => {
    const config = defaultHotkeyConfig();
    const options = "altwin:swap_alt_win,ctrl:nocaps";
    expect(hotkeyMatches(config, 193, new Set([42, 56, 193]), options)).toBe(true);
    expect(hotkeyMatches(config, 193, new Set([42, 193]), options)).toBe(false);
    expect(hotkeyMatches(config, 30, new Set([42, 56, 30]), options)).toBe(false);
    const once = replaceManagedBinding("-- user config\n", config);
    const twice = replaceManagedBinding(once, config);
    expect(twice).toBe(once);
    expect((twice.match(/Swallow Aqua dictation hotkey/g) || [])).toHaveLength(1);
  });

  test("parses only Aqua's official desktop token callback", () => {
    expect(signInUrl).toBe("https://aquavoice.com/sign-in?origin=desktop");
    expect(parseCallbackUrl("aquavoice://token=header.payload.signature/"))
      .toBe("header.payload.signature");
    expect(() => parseCallbackUrl("https://example.com/?token=secret")).toThrow();
    expect(() => parseCallbackUrl("aquavoice://token=has%20space")).toThrow();
  });

  test("frames PCM with Aqua's 8-byte big-endian header", () => {
    const pcm = Buffer.alloc(3200, 7);
    const frame = audioFrame(pcm);
    expect([...frame.subarray(0, 8)]).toEqual([1, 0, 0, 0, 0, 0, 0, 4]);
    expect(frame.subarray(8)).toEqual(pcm);
  });

  test("prefers annotated finalized text", () => {
    expect(displayText({
      display_text_annotated: [{ text: "Hello " }, { text: "world" }],
      raw_text: "raw",
    })).toBe("Hello world");
  });

  test("requires two timely taps and stops on the next tap", () => {
    expect(gestureDecision("idle", 0, 1000)).toBe("arm");
    expect(gestureDecision("armed", 1000, 1300)).toBe("start");
    expect(gestureDecision("armed", 1000, 1651)).toBe("arm");
    expect(gestureDecision("recording", 0, 2000)).toBe("stop");
    expect(gestureDecision("processing", 0, 2000)).toBe("ignore");
  });

  test("uses Aqua hands-free realtime start metadata", () => {
    const payload = startPayload({ language: "en", transcriptionModel: "avalon-v1.1", casualMessaging: true }, { class: "chatgpt" });
    expect(payload.type).toBe("start");
    expect(payload.audio_format).toBe("pcm_s16le");
    expect(payload.streaming).toBe(true);
    expect(payload.metadata.activation_mode).toBe("hands_free");
    expect(payload.context.app).toBe("chatgpt");
    expect(payload.casual_messaging).toBe(true);
  });

  test("redacts Aqua settings to the fields the plugin can display", () => {
    const visible = publicSettings({
      token: "secret",
      language: "cmn",
      savedLanguages: ["auto", "en", "cmn"],
      transcriptionModel: "avalon-v1.1",
      dictionary: ["Omarchy"],
      replacements: [{ from: "aq", to: "Aqua" }],
      customInstructions: "Use short paragraphs",
      casualMessaging: true,
    });
    expect(visible.language).toBe("cmn");
    expect(visible.dictionaryCount).toBe(1);
    expect(visible.replacementCount).toBe(1);
    expect(visible.customInstructionsConfigured).toBe(true);
    expect(visible.casualMessaging).toBe(true);
    expect(visible.dictionary).toEqual(["Omarchy"]);
    expect(visible.token).toBeUndefined();
  });

  test("normalizes Aqua's account customization document", () => {
    const normalized = normalizeTranscriptCustomizations({
      revision: 9,
      customizations: {
        dictionary: ["Omarchy", "", 42],
        replacements: [{ from: "aq", to: "Aqua" }],
        customInstructions: "Use short paragraphs",
      },
    });
    expect(normalized.revision).toBe(9);
    expect(normalized.dictionary).toEqual(["Omarchy"]);
    expect(normalized.replacements).toHaveLength(1);
    expect(normalized.customInstructions).toBe("Use short paragraphs");
  });

  test("does not let a stale dictionary fetch overwrite a newer operation", () => {
    expect(shouldApplyCustomizationRevision(12, 11)).toBe(false);
    expect(shouldApplyCustomizationRevision(12, 12)).toBe(true);
    expect(shouldApplyCustomizationRevision(12, 13)).toBe(true);
    expect(shouldApplyCustomizationRevision(Number.NaN, 1)).toBe(true);
  });

  test("uses Omarchy's Shift-Insert path for tagged terminal windows", () => {
    expect(isTerminalClass("com.mitchellh.ghostty")).toBe(true);
    expect(isTerminalClass("foot")).toBe(true);
    expect(isTerminalClass("chatgpt")).toBe(false);
    expect(pasteCommand("com.mitchellh.ghostty")).toContain("shift");
    expect(pasteCommand("chatgpt")).not.toContain("shift");
    expect(pasteCommand("com.mitchellh.ghostty").slice(-2)).toEqual(["-p", "VoidSymbol"]);
    expect(pasteShortcut("custom-terminal-class", true)).toEqual({ mods: "SHIFT", key: "Insert", label: "Shift+Insert" });
    expect(pasteShortcut("chatgpt", false)).toEqual({ mods: "CTRL", key: "V", label: "Ctrl+V" });
  });

  test("tracks physical Alt releases for Alt-to-Super keymaps", () => {
    expect(isTrackedHotkeyCode(56)).toBe(true);
    expect(isTrackedHotkeyCode(100)).toBe(true);
    expect(isTrackedHotkeyCode(125)).toBe(true);
    expect(isTrackedHotkeyCode(30)).toBe(false);
  });

  test("pastes only while the same Hyprland client remains focused", () => {
    expect(focusIsStable({ address: "0xabc" }, { address: "0xabc" })).toBe(true);
    expect(focusIsStable({ address: "0xabc" }, { address: "0xdef" })).toBe(false);
    expect(focusIsStable(null, { address: "0xabc" })).toBe(false);
  });

  test("retries one failed finalization when buffered audio exists", () => {
    expect(shouldRetryFinalization("processing", 0, 6400)).toBe(true);
    expect(shouldRetryFinalization("processing", 1, 6400)).toBe(false);
    expect(shouldRetryFinalization("recording", 0, 6400)).toBe(false);
    expect(shouldRetryFinalization("processing", 0, 0)).toBe(false);
  });
});
