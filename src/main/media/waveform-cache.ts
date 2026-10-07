import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { ProbedSource } from "./probe.ts";
import { waveformResolution } from "../../shared/media.ts";
import type { WaveformChunk, WaveformResult } from "./waveform-decode.ts";

const cacheBytes = 128 * 1024 * 1024;
const maxFileBytes = 24_000_000;
const headerBytes = 16;
const magic = Buffer.from("ATWAVE03");

export function waveformCacheKey(source: ProbedSource, tracks: number[], preview?: { path: string; size: number; mtimeMs: number }): string {
   return createHash("sha256")
      .update(
         JSON.stringify([
            4,
            process.platform === "win32" ? source.path.toLowerCase() : source.path,
            source.fileIdentity,
            source.size,
            source.modified,
            source.duration,
            source.startOffset,
            [...tracks].sort((a, b) => a - b),
            waveformResolution(source.duration),
            preview,
         ])
      )
      .digest("hex");
}

/** Cache failures leave the optional waveform usable. Only completed files become hits. */
export async function pruneWaveforms(folder: string, budget = cacheBytes, startup = false): Promise<void> {
   const names = await readdir(folder).catch(() => []);
   if (startup)
      for (const name of names.filter((name) => /^[a-f0-9]{64}\.[a-f0-9-]{36}\.tmp$/.test(name)))
         await rm(join(folder, name), { force: true }).catch(() => undefined);
   const files = (
      await Promise.all(
         names
            .filter((name) => /^[a-f0-9]{64}\.wave$/.test(name))
            .map(async (name) => {
               const path = join(folder, name);
               const info = await stat(path).catch(() => null);
               return info ? { path, size: info.size, mtime: info.mtimeMs } : null;
            })
      )
   )
      .filter((file) => file !== null)
      .sort((a, b) => b.mtime - a.mtime);
   let used = 0;
   for (const file of files) {
      if (file.size > maxFileBytes + headerBytes || used + file.size > budget) await rm(file.path, { force: true }).catch(() => undefined);
      else used += file.size;
   }
}

export async function cachedWaveform(
   folder: string,
   key: string,
   rate: number,
   duration: number,
   signal: AbortSignal | undefined,
   consume: (chunk: WaveformChunk) => Promise<void>,
   decode: (consume: (chunk: WaveformChunk) => Promise<void>) => Promise<WaveformResult | null>,
   onHit?: () => void
): Promise<WaveformResult | null> {
   const path = join(folder, `${key}.wave`);
   const reader = await open(path, "r").catch(() => null);
   if (reader) {
      try {
         const info = await reader.stat();
         const header = Buffer.alloc(headerBytes);
         await reader.read(header, 0, header.length, 0);
         const buckets = header.readUInt32LE(12);
         if (
            !header.subarray(0, 8).equals(magic) ||
            header.readUInt32LE(8) !== rate ||
            buckets !== Math.ceil(duration * rate) ||
            info.size !== headerBytes + buckets * 3 ||
            buckets * 3 > maxFileBytes
         )
            throw new Error("Invalid waveform cache");
         onHit?.();
         let offset = 0;
         while (offset < buckets) {
            signal?.throwIfAborted();
            const peaks = Buffer.alloc(Math.min(65535, (buckets - offset) * 3));
            const { bytesRead } = await reader.read(peaks, 0, peaks.length, headerBytes + offset * 3);
            if (bytesRead !== peaks.length) throw new Error("Incomplete waveform cache");
            await consume({ offset, peaks, rate });
            offset += peaks.length / 3;
         }
         await utimes(path, new Date(), new Date()).catch(() => undefined);
         return { rate, buckets };
      } catch (error) {
         signal?.throwIfAborted();
         // A read that already emitted chunks must not start a second decode at offset zero.
         if (!(error instanceof Error) || error.message !== "Invalid waveform cache") throw error;
      } finally {
         await reader.close();
      }
   }
   signal?.throwIfAborted();
   await mkdir(folder, { recursive: true }).catch(() => undefined);
   const temporary = join(folder, `${key}.${randomUUID()}.tmp`);
   let writer = await open(temporary, "wx").catch(() => null);
   if (writer) {
      try {
         await writer.writeFile(Buffer.alloc(headerBytes));
      } catch {
         await writer.close().catch(() => undefined);
         writer = null;
      }
   }
   let bytes = 0;
   try {
      const result = await decode(async (chunk) => {
         signal?.throwIfAborted();
         bytes += chunk.peaks.byteLength;
         if (bytes > maxFileBytes) throw new Error("Waveform exceeded its cache budget");
         if (writer) {
            try {
               await writer.writeFile(chunk.peaks);
            } catch {
               await writer.close().catch(() => undefined);
               writer = null;
            }
         }
         await consume(chunk);
      });
      signal?.throwIfAborted();
      if (result && writer && result.buckets === Math.ceil(duration * rate) && bytes === result.buckets * 3) {
         const header = Buffer.alloc(headerBytes);
         magic.copy(header);
         header.writeUInt32LE(rate, 8);
         header.writeUInt32LE(result.buckets, 12);
         try {
            await writer.write(header, 0, header.length, 0);
            await writer.close();
            writer = null;
            await rename(temporary, path);
            await pruneWaveforms(folder);
         } catch {
            /* Cache storage must not turn a successful waveform into a failure. */
         }
      }
      return result;
   } finally {
      await writer?.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
   }
}
