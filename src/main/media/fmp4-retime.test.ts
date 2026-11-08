import { describe, expect, it } from "vitest";
import { Fmp4Retimer } from "./fmp4-retime.ts";
import { frameAtOrBefore } from "./stream.ts";

function box(type: string, ...parts: Buffer[]): Buffer {
   const body = Buffer.concat(parts);
   const header = Buffer.alloc(8);
   header.writeUInt32BE(body.length + 8, 0);
   header.write(type, 4, "latin1");
   return Buffer.concat([header, body]);
}
function full(version: number, flags: number, ...fields: Buffer[]): Buffer {
   const head = Buffer.alloc(4);
   head.writeUInt32BE((version << 24) | flags, 0);
   return Buffer.concat([head, ...fields]);
}
function u32(...values: number[]): Buffer {
   const buffer = Buffer.alloc(values.length * 4);
   values.forEach((value, index) => buffer.writeUInt32BE(value >>> 0, index * 4));
   return buffer;
}
function u64(value: bigint): Buffer {
   const buffer = Buffer.alloc(8);
   buffer.writeBigUInt64BE(value);
   return buffer;
}
function trak(id: number, timescale: number, handler: string): Buffer {
   return box(
      "trak",
      box("tkhd", full(0, 3, u32(0, 0, id))),
      box("mdia", box("mdhd", full(0, 0, u32(0, 0, timescale, 0))), box("hdlr", full(0, 0, u32(0), Buffer.from(handler, "latin1"), Buffer.alloc(12))))
   );
}
function traf(id: number, decodeTime: bigint, firstOffset: number | null): Buffer {
   // One sample: duration, size and (for video) a composition offset.
   const trun = firstOffset === null ? box("trun", full(0, 0x301, u32(1, 0, 1024, 10))) : box("trun", full(1, 0xb01, u32(1, 0, 1500, 10, firstOffset)));
   return box("traf", box("tfhd", full(0, 0x20000, u32(id))), box("tfdt", full(1, 0, u64(decodeTime))), trun);
}
function decodeTimes(stream: Buffer): number[] {
   const times: number[] = [];
   for (let index = 0; index + 8 <= stream.length; index++)
      if (stream.toString("latin1", index, index + 4) === "tfdt") times.push(Number(stream.readBigUInt64BE(index + 8)));
   return times;
}
async function run(input: Buffer, chunk: number, starts: { video: number; audio: number }): Promise<Buffer> {
   const retimer = new Fmp4Retimer(starts);
   const output: Buffer[] = [];
   retimer.on("data", (data: Buffer) => output.push(data));
   const finished = new Promise((resolve, reject) => {
      retimer.on("end", resolve);
      retimer.on("error", reject);
   });
   for (let offset = 0; offset < input.length; offset += chunk) retimer.write(input.subarray(offset, offset + chunk));
   retimer.end();
   await finished;
   return Buffer.concat(output);
}

describe("fragmented preview retiming", () => {
   const media = Buffer.from("not a box header: moof trun mdat", "latin1");
   const input = Buffer.concat([
      box("ftyp", Buffer.from("isom", "latin1")),
      box("moov", box("mvhd", full(0, 0, u32(0, 0, 1000, 0))), trak(1, 90000, "vide"), trak(2, 48000, "soun")),
      box("moof", box("mfhd", full(0, 0, u32(1))), traf(1, 0n, 3000), traf(2, 0n, null)),
      box("mdat", media),
      box("moof", box("mfhd", full(0, 0, u32(2))), traf(1, 1500n, 3000), traf(2, 1024n, null)),
      box("mdat", media),
   ]);

   it("places each track's first sample at its source time and keeps later fragments in step", async () => {
      for (const chunk of [1, 7, 64, input.length]) {
         const output = await run(input, chunk, { video: 12.5, audio: 12.49 });
         expect(output.length).toBe(input.length);
         // Video presents at decode time plus its composition offset of 3000 ticks.
         const video = 12.5 * 90000 - 3000;
         const audio = Math.round(12.49 * 48000);
         expect(decodeTimes(output)).toEqual([video, audio, video + 1500, audio + 1024]);
         // Media data passes through byte for byte, even when it looks like box names.
         expect(output.includes(media)).toBe(true);
      }
   });

   it("fails a stream that ends inside a box instead of passing a truncated fragment", async () => {
      await expect(run(input.subarray(0, input.length - 3), 16, { video: 1, audio: 1 })).rejects.toThrow(/ended inside a box/);
   });
});

describe("stream start frame", () => {
   it("starts on the frame shown at the requested time", () => {
      const frames = [0.02, 0.0533, 0.0867, 0.12];
      expect(frameAtOrBefore(frames, 0)).toBe(0.02);
      expect(frameAtOrBefore(frames, 0.0533)).toBe(0.0533);
      expect(frameAtOrBefore(frames, 0.08)).toBe(0.0533);
      expect(frameAtOrBefore(frames, 5)).toBe(0.12);
      expect(frameAtOrBefore([], 3)).toBe(0);
   });
});
