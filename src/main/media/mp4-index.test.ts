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
async function readTable(count: number, keys?: number[]) {
   const directory = await mkdtemp(join(tmpdir(), "attacut-table-"));
   try {
      const header = Buffer.alloc(16);
      header.writeUInt32BE(30, 12);
      const handler = Buffer.alloc(12);
      handler.write("vide", 8);
      const timing = Buffer.alloc(16);
      timing.writeUInt32BE(1, 4);
      timing.writeUInt32BE(count, 8);
      timing.writeUInt32BE(1, 12);
      const tables = [box("stts", timing)];
      if (keys) {
         const sync = Buffer.alloc(8 + keys.length * 4);
         sync.writeUInt32BE(keys.length, 4);
         keys.forEach((key, index) => sync.writeUInt32BE(key, 8 + index * 4));
         tables.push(box("stss", sync));
      }
      const bytes = box(
         "moov",
         box("trak", box("mdia", Buffer.concat([box("mdhd", header), box("hdlr", handler), box("minf", box("stbl", Buffer.concat(tables)))])))
      );
      const path = join(directory, "table.mp4");
      await writeFile(path, bytes);
      return await indexedSampleTimes({
         path,
         size: bytes.length,
         extension: ".mp4",
         duration: count / 30,
         startOffset: 0,
         streams: [],
      } as unknown as ProbedSource);
   } finally {
      await rm(directory, { recursive: true, force: true });
   }
}
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
