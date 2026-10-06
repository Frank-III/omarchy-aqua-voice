export function microphoneOptions(snapshot) {
  const seen = new Set();
  const devices = [{ value: "", label: "System default" }];
  for (const node of snapshot) {
    const props = node?.info?.props;
    const name = props?.["node.name"];
    if (node.type !== "PipeWire:Interface:Node" || props?.["media.class"] !== "Audio/Source"
        || typeof name !== "string" || seen.has(name)) continue;
    seen.add(name);
    devices.push({ value: name, label: String(props["node.description"] || props["node.nick"] || name) });
  }
  return devices;
}

export function recorderCommand(target = "") {
  return ["pw-record", "--raw", "--rate", "16000", "--channels", "1", "--format", "s16",
    ...(target ? ["--target", target] : []), "-"];
}

export async function listMicrophones() {
  const child = Bun.spawn(["pw-dump"], { stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => child.kill(), 3000);
  try {
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0) throw new Error("Could not list microphones. Check PipeWire.");
    return microphoneOptions(JSON.parse(output));
  } finally { clearTimeout(timer); }
}
