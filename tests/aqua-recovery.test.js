import { test, expect } from "bun:test";
import { finalizationTimeout, recoverRecording, pcmWav, reportRecoveryOutcome } from "../bin/aqua-recovery.js";

const input = () => ({stopSent:true,sessionId:123,token:"test-token",signal:new AbortController().signal});

test("finalization budget grows with recording duration", () => {
  expect(finalizationTimeout(0)).toBe(15000);
  expect(finalizationTimeout(60000)).toBe(16000);
  expect(finalizationTimeout(180000)).toBe(18000);
});

test("after stop_request, recovery closes with 4003 and polls only the original session", async () => {
  const closes = []; const requests = [];
  const result = await recoverRecording({...input(),socket:{close:(...args)=>closes.push(args)}}, {
    intervalMs:1,
    fetcher: async (url, options) => {
      requests.push(url);
      expect(options.headers.Authorization).toBe("Bearer test-token");
      expect(options.method).toBeUndefined();
      return Response.json(requests.length === 1 ? {state:"pending"} : {state:"ready",text:" recovered "});
    },
  });
  expect(closes).toEqual([[4003,"recovery requested"]]);
  expect(requests).toEqual(Array(2).fill("https://realtime.aquavoice.com/session-recovery/123"));
  expect(result).toBe(" recovered ");
});

test("empty recovery ends without retranscribing", async () => {
  let calls=0;
  expect(await recoverRecording(input(),{fetcher:async()=>{calls++;return Response.json({state:"empty"});}})).toBe("");
  expect(calls).toBe(1);
});

test("before stop_request, recovery uploads a PCM16 WAV with original session metadata", async () => {
  const audio=Buffer.from([1,0,2,0]);
  const result=await recoverRecording({...input(),stopSent:false,audio,language:"en"},{fetcher:async(url, options)=>{
    expect(url).toBe("https://realtime.aquavoice.com/retranscribe");
    expect(options.method).toBe("POST");
    expect(options.body.get("origin")).toBe("websocket_fallback");
    expect(options.body.get("sessionId")).toBe("123");
    expect(options.body.get("language")).toBe("en");
    const wav=Buffer.from(await options.body.get("audio").arrayBuffer());
    expect(wav.subarray(0,4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.subarray(44)).toEqual(audio);
    return Response.json({success:true,transcription:"recovered"});
  }});
  expect(result).toBe("recovered");
});

test("missing session ID after stop never triggers a second transcription", async () => {
  let calls=0;
  await expect(recoverRecording({...input(),sessionId:null},{fetcher:async()=>{calls++;}})).rejects.toThrow("session ID");
  expect(calls).toBe(0);
});

test("recovery polling is bounded and user cancellation stops pending polling", async () => {
  await expect(recoverRecording(input(),{timeoutMs:15,intervalMs:2,fetcher:async()=>Response.json({state:"pending"})})).rejects.toThrow();
  const controller=new AbortController();
  let calls=0;
  const recovery=recoverRecording({...input(),signal:controller.signal},{intervalMs:10000,fetcher:async()=>{
    calls++;controller.abort();return Response.json({state:"pending"});
  }});
  await expect(recovery).rejects.toThrow();
  expect(calls).toBe(1);
});

test("recovery outcome includes clipboard/panel text and is skipped without a session ID", async () => {
  const requests=[];
  const fetcher=async(url,options)=>{requests.push(JSON.parse(options.body));return new Response(null,{status:204});};
  await reportRecoveryOutcome(123,"server_recovery","hello","token",fetcher);
  await reportRecoveryOutcome(null,"http","hello","token",fetcher);
  expect(requests).toEqual([{session_id:123,recovery_type:"server_recovery",inserted_text_length:5}]);
});
