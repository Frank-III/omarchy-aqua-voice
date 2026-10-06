import { test, expect } from "bun:test";
import { microphoneOptions, recorderCommand } from "../bin/aqua-audio.js";
import { connectionGate } from "../bin/aqua-connection.js";

test("microphone discovery uses stable node names and excludes output devices", () => {
  const node=(name,mediaClass,label)=>({type:"PipeWire:Interface:Node",info:{props:{"node.name":name,"media.class":mediaClass,"node.description":label}}});
  expect(microphoneOptions([node("usb-mic","Audio/Source","USB Mic"),node("speaker","Audio/Sink","Speakers"),node("usb-mic","Audio/Source","Duplicate")])).toEqual([{value:"",label:"System default"},{value:"usb-mic",label:"USB Mic"}]);
  expect(recorderCommand()).not.toContain("--target");
  expect(recorderCommand("usb-mic").slice(-3)).toEqual(["--target","usb-mic","-"]);
});

test("early stop can await ready without scheduling a second transcription", async () => {
  const problems=[];
  const gate=connectionGate(new AbortController().signal,x=>problems.push(x),50);
  let settled=false;
  const waiter=gate.ready.then(x=>{settled=true;return x;});
  await Bun.sleep(5);expect(settled).toBe(false);
  gate.accept();expect(await waiter).toBe(true);
  await Bun.sleep(55);expect(problems).toEqual([]);
});

test("connection stalls are bounded; failure is reported once", async () => {
  const problems=[];
  const gate=connectionGate(new AbortController().signal,x=>problems.push(x),10);
  expect(await gate.ready).toBe(false);
  gate.fail("late close");gate.accept();
  expect(problems).toHaveLength(1);
});

test("canceling while waiting for ready does not trigger recovery", async () => {
  const controller=new AbortController();const problems=[];
  const gate=connectionGate(controller.signal,x=>problems.push(x),50);
  controller.abort();expect(await gate.ready).toBe(false);
  gate.accept();expect(problems).toEqual([]);
});
