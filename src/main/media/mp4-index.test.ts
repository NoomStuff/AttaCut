import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { indexedSampleTimes } from "./mp4-index";
import type { ProbedSource } from "./probe";

function box(name: string, data: Buffer): Buffer {
   const result = Buffer.alloc(data.length + 8);
   result.writeUInt32BE(result.length);
   result.write(name, 4);
   data.copy(result, 8);
   return result;
}
async function readTable(count: number, keys?: number[], options: { scale?: number; delta?: number; mediaTime?: number; extension?: string } = {}) {
   const { scale = 30, delta = 1, mediaTime } = options;
   const directory = await mkdtemp(join(tmpdir(), "attacut-table-"));
   try {
      const header = Buffer.alloc(16);
      header.writeUInt32BE(scale, 12);
      const handler = Buffer.alloc(12);
      handler.write("vide", 8);
      const timing = Buffer.alloc(16);
      timing.writeUInt32BE(1, 4);
      timing.writeUInt32BE(count, 8);
      timing.writeUInt32BE(delta, 12);
      const tables = [box("stts", timing)];
      if (keys) {
         const sync = Buffer.alloc(8 + keys.length * 4);
         sync.writeUInt32BE(keys.length, 4);
         keys.forEach((key, index) => sync.writeUInt32BE(key, 8 + index * 4));
         tables.push(box("stss", sync));
      }
      const duration = (count * delta * 1000) / scale;
      const media = box("mdia", Buffer.concat([box("mdhd", header), box("hdlr", handler), box("minf", box("stbl", Buffer.concat(tables)))]));
      let trak = box("trak", media);
      const root: Buffer[] = [];
      if (mediaTime !== undefined) {
         const mvhd = Buffer.alloc(100);
         mvhd.writeUInt32BE(1000, 12);
         mvhd.writeUInt32BE(duration, 16);
         const elst = Buffer.alloc(24);
         elst.writeUInt32BE(1, 4);
         elst.writeUInt32BE(duration, 8);
         elst.writeInt32BE(mediaTime, 12);
         elst.writeUInt16BE(1, 16);
         root.push(box("mvhd", mvhd));
         trak = box("trak", Buffer.concat([box("edts", box("elst", elst)), media]));
      }
      root.push(trak);
      const bytes = box("moov", Buffer.concat(root));
      const path = join(directory, "table.mp4");
      await writeFile(path, bytes);
      return await indexedSampleTimes({
         path,
         size: bytes.length,
         extension: options.extension ?? ".mp4",
         duration: (count * delta) / scale,
         startOffset: 0,
         streams: [],
      } as unknown as ProbedSource);
   } finally {
      await rm(directory, { recursive: true, force: true });
   }
}
it("indexes recordings with uppercase extensions", async () => {
   const result = await readTable(3, undefined, { extension: ".MP4" });
   expect(Array.from(result!.frames!)).toEqual([0, 1 / 30, 2 / 30]);
});
it("shares frame and keyframe storage for implicit and explicit all-sync tables", async () => {
   for (const keys of [undefined, [1, 2, 3]]) {
      const result = await readTable(3, keys);
      expect(result?.keyframes).toBe(result?.frames);
      expect(Array.from(result!.frames!)).toEqual([0, 1 / 30, 2 / 30]);
   }
});
it("keeps sparse keys in compact storage and rejects invalid sample order", async () => {
   const result = await readTable(5, [1, 3]);
   expect(result?.keyframes).toBeInstanceOf(Float64Array);
   expect(Array.from(result!.keyframes)).toEqual([0, 2 / 30]);
   expect(result?.keyframes).not.toBe(result?.frames);
   expect(await readTable(5, [2, 1])).toBeNull();
   expect(await readTable(5, [1, 6])).toBeNull();
});
it("falls back before allocating an all-sync index beyond its byte budget", async () => {
   expect(await readTable(8_388_609)).toBeNull();
});
it("applies edit-list offsets without losing precision", async () => {
   // A 30fps table with a 1024-tick edit shift: sample 122 must land on exactly 4 seconds,
   // which a float pre-division of the shift rounds one ulp below.
   const result = await readTable(123, undefined, { scale: 15360, delta: 512, mediaTime: 1024 });
   const frames = Array.from(result!.frames!);
   expect(frames.at(-1)).toBe(4);
   expect(frames.at(-2)).toBeCloseTo(3.9666666666666663, 15);
});
