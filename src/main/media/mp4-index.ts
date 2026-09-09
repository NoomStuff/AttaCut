import { open } from "node:fs/promises";
import type { ProbedSource } from "./probe.ts";

interface Box {
   type: string;
   start: number;
   end: number;
}
function boxes(data: Buffer, start = 0, end = data.length): Box[] {
   const result: Box[] = [];
   while (start + 8 <= end) {
      let size = data.readUInt32BE(start);
      let header = 8;
      if (size === 1) {
         if (start + 16 > end) return [];
         size = Number(data.readBigUInt64BE(start + 8));
         header = 16;
      }
      if (size === 0) size = end - start;
      if (size < header || start + size > end) return [];
      result.push({ type: data.toString("ascii", start + 4, start + 8), start: start + header, end: start + size });
      start += size;
   }
   return result;
}
function child(data: Buffer, parent: Box, type: string): Box | undefined {
   return boxes(data, parent.start, parent.end).find((box) => box.type === type);
}
function entries(data: Buffer, box: Box, stride: number): number {
   const count = data.readUInt32BE(box.start + 4);
   if (box.start + 8 + count * stride > box.end) throw new Error("Invalid sample table");
   return count;
}

/** Read MP4/MOV sample tables without reading or decoding the video payload. */
export async function indexedKeyframes(source: ProbedSource, signal?: AbortSignal): Promise<number[] | null> {
   if (![".mp4", ".m4v", ".mov"].includes(source.extension)) return null;
   const file = await open(source.path, "r");
   try {
      const header = Buffer.alloc(16);
      let offset = 0;
      while (offset + 8 <= source.size) {
         signal?.throwIfAborted();
         await file.read(header, 0, 16, offset);
         let size = header.readUInt32BE(0);
         let headerSize = 8;
         if (size === 1) {
            size = Number(header.readBigUInt64BE(8));
            headerSize = 16;
         }
         if (size === 0) size = source.size - offset;
         if (size < headerSize || offset + size > source.size) return null;
         if (header.toString("ascii", 4, 8) !== "moov") {
            offset += size;
            continue;
         }
         if (size > 64 * 1024 * 1024) return null;
         const data = Buffer.alloc(size - headerSize);
         const read = await file.read(data, 0, data.length, offset + headerSize);
         if (read.bytesRead !== data.length) return null;
         const root = { type: "moov", start: 0, end: data.length };
         if (child(data, root, "mvex")) return null; // Fragmented MP4 needs packet scanning.
         const tracks = boxes(data)
            .filter((box) => box.type === "trak")
            .map((track) => ({ track, mdia: child(data, track, "mdia") }))
            .filter(({ mdia }) => {
               const handler = mdia && child(data, mdia, "hdlr");
               return handler && data.toString("ascii", handler.start + 8, handler.start + 12) === "vide";
            });
         if (tracks.length !== 1) return null;
         const { track, mdia } = tracks[0]!;
         const mdhd = child(data, mdia!, "mdhd");
         const minf = child(data, mdia!, "minf");
         const table = minf && child(data, minf, "stbl");
         if (!mdhd || !table) return null;
         const scale = data.readUInt32BE(mdhd.start + (data[mdhd.start] === 1 ? 20 : 12));
         if (!scale) return null;
         const stts = child(data, table, "stts");
         const stss = child(data, table, "stss");
         const ctts = child(data, table, "ctts");
         if (!stts) return null;
         const timing = Array.from({ length: entries(data, stts, 8) }, (_, i) => ({
            count: data.readUInt32BE(stts.start + 8 + i * 8),
            delta: data.readUInt32BE(stts.start + 12 + i * 8),
         }));
         const total = timing.reduce((sum, entry) => sum + entry.count, 0);
         if (!total || total > 20_000_000) return null;
         const samples = stss
            ? Array.from({ length: entries(data, stss, 4) }, (_, i) => data.readUInt32BE(stss.start + 8 + i * 4) - 1)
            : Array.from({ length: total }, (_, i) => i);
         const composition = ctts
            ? Array.from({ length: entries(data, ctts, 8) }, (_, i) => ({
                 count: data.readUInt32BE(ctts.start + 8 + i * 8),
                 delta: data[ctts.start] === 1 ? data.readInt32BE(ctts.start + 12 + i * 8) : data.readUInt32BE(ctts.start + 12 + i * 8),
              }))
            : [];
         let editOffset = 0;
         const edts = child(data, track, "edts");
         const elst = edts && child(data, edts, "elst");
         if (elst) {
            const mvhd = child(data, root, "mvhd");
            if (!mvhd) return null;
            const movieScale = data.readUInt32BE(mvhd.start + (data[mvhd.start] === 1 ? 20 : 12));
            const wide = data[elst.start] === 1;
            const stride = wide ? 20 : 12;
            let mediaEdits = 0;
            for (let i = 0; i < entries(data, elst, stride); i++) {
               const p = elst.start + 8 + i * stride;
               const duration = wide ? Number(data.readBigUInt64BE(p)) : data.readUInt32BE(p);
               const mediaTime = wide ? Number(data.readBigInt64BE(p + 8)) : data.readInt32BE(p + 4);
               if (data.readInt16BE(p + (wide ? 16 : 8)) !== 1 || data.readInt16BE(p + (wide ? 18 : 10)) !== 0) return null;
               if (mediaTime === -1 && mediaEdits === 0) editOffset += duration / movieScale;
               else if (mediaTime >= 0 && mediaEdits++ === 0) editOffset -= mediaTime / scale;
               else return null;
            }
         }
         let ti = 0,
            ts = 0,
            time = 0,
            ci = 0,
            cs = 0;
         const result: number[] = [];
         for (const sample of samples) {
            if (sample < ts || sample >= total) return null;
            while (timing[ti] && sample >= ts + timing[ti]!.count) {
               time += timing[ti]!.count * timing[ti]!.delta;
               ts += timing[ti++]!.count;
            }
            while (composition[ci] && sample >= cs + composition[ci]!.count) cs += composition[ci++]!.count;
            const point = (time + (sample - ts) * timing[ti]!.delta + (composition[ci]?.delta ?? 0)) / scale + editOffset - source.startOffset;
            if (point >= -0.000001 && point <= source.duration) result.push(Math.max(0, point));
         }
         return result.sort((a, b) => a - b);
      }
      return null;
   } catch (error) {
      if (signal?.aborted) throw error;
      return null;
   } finally {
      await file.close();
   }
}
