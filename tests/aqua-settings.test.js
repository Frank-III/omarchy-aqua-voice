import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("personalization writes require a valid server response; failures preserve local settings", () => {
  const directory = mkdtempSync(join(tmpdir(), "aqua-settings-test-"));
  const script = `
    import { requestTranscriptCustomizations, customizationRequest, readAquaSettings, setSetting } from ${JSON.stringify(resolve("bin/aqua-settings.js"))};
    import { expect } from "bun:test";
    await Bun.write(process.env.AQUA_SETTINGS_PATH, JSON.stringify({language:"en",savedLanguages:["en"],dictionary:["original"],replacements:[],customInstructions:"keep"}));
    setSetting("language", "ja");
    expect(readAquaSettings().language).toBe("ja");
    expect(readAquaSettings().savedLanguages).toEqual(["en", "ja"]);
    expect(() => setSetting("language", "invented")).toThrow();
    const body = customizationRequest({type:"replacement_upsert",replacement:{from:"aq",to:"Aqua"}});
    globalThis.fetch = async (url, options) => {
      expect(url).toBe("https://core.aquavoice.com/users/transcript-customizations/");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual(body);
      return Response.json({revision:1,customizations:{dictionary:["original"],replacements:[{from:"aq",to:"Aqua"}],customInstructions:"keep"}});
    };
    await requestTranscriptCustomizations(body);
    const saved = readAquaSettings();
    expect(saved.replacements).toEqual([{from:"aq",to:"Aqua"}]);
    expect(saved._aquaOmarchyCustomizationSyncedAt).toBeTruthy();
    for (const response of [Response.json({message:"Denied"},{status:403}),Response.json({})]) {
      globalThis.fetch = async () => response;
      await expect(requestTranscriptCustomizations(body)).rejects.toThrow();
      expect(readAquaSettings()).toEqual(saved);
    }
  `;
  try {
    const result = Bun.spawnSync([process.execPath, "--eval", script], {
      env: { ...process.env, AQUA_SETTINGS_PATH: join(directory, "settings.json"), AQUA_VOICE_TOKEN: "test-only-token" },
    });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
