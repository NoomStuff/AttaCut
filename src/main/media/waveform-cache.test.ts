import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedWaveform, pruneWaveforms, waveformCacheKey } from "./waveform-cache";
import type { ProbedSource } from "./probe";
import type { WaveformChunk } from "./waveform-decode";
const folders: string[] = [];
async function folder() {
   const path = await mkdtemp(join(tmpdir(), "attacut-wave-"));
   folders.push(path);
   return path;
}
afterEach(async () => {
   await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const source = { path: "recording.mp4", size: 100, modified: 123, duration: 1, startOffset: 0, fileIdentity: { device: 1, inode: 2 } } as ProbedSource;
const key = waveformCacheKey(source, [1]);
const peaks = Uint8Array.from({ length: 3000 }, (_, i) => i % 255);
const decode = async (consume: (chunk: WaveformChunk) => Promise<void>) => {
   await consume({ offset: 0, rate: 1000, peaks });
   return { rate: 1000, buckets: 1000 };
};

it("streams a durable hit without decoding and keys selections and file identities", async () => {
   const path = await folder();
   const chunks: Uint8Array[] = [];
   await cachedWaveform(path, key, 1000, 1, undefined, async () => {}, decode);
   const miss = vi.fn(decode);
   const hit = vi.fn();
   expect(
      await cachedWaveform(
         path,
         key,
         1000,
         1,
         undefined,
         async (c) => {
            chunks.push(c.peaks.slice());
         },
         miss,
         hit
      )
   ).toEqual({ rate: 1000, buckets: 1000 });
   expect(miss).not.toHaveBeenCalled();
   expect(hit).toHaveBeenCalledOnce();
   expect(Uint8Array.from(chunks[0]!)).toEqual(peaks);
   expect(waveformCacheKey(source, [3, 1])).toBe(waveformCacheKey(source, [1, 3]));
   for (const changed of [
      { ...source, size: 101 },
      { ...source, modified: 124 },
      { ...source, fileIdentity: { device: 1, inode: 3 } },
   ])
      expect(waveformCacheKey(changed, [1])).not.toBe(key);
   expect(waveformCacheKey(source, [2])).not.toBe(key);
   expect(waveformCacheKey(source, [1], { path: "preview", size: 1, mtimeMs: 2 })).not.toBe(key);
});

it("rebuilds corrupt or truncated hits and never publishes a cancelled run", async () => {
   const path = await folder();
   await cachedWaveform(path, key, 1000, 1, undefined, async () => {}, decode);
   const file = join(path, `${key}.wave`);
   const bytes = await readFile(file);
   await writeFile(file, bytes.subarray(0, 100));
   const rebuild = vi.fn(decode);
   await cachedWaveform(path, key, 1000, 1, undefined, async () => {}, rebuild);
   expect(rebuild).toHaveBeenCalledOnce();
   await rm(file);
   const controller = new AbortController();
   await expect(
      cachedWaveform(
         path,
         key,
         1000,
         1,
         controller.signal,
         async () => {
            controller.abort();
         },
         decode
      )
   ).rejects.toThrow();
   expect(await readdir(path)).toEqual([]);
});

it("prunes by bytes and clears only its own interrupted files on startup", async () => {
   const path = await folder();
   const a = join(path, `${"a".repeat(64)}.wave`),
      b = join(path, `${"b".repeat(64)}.wave`);
   await writeFile(a, Buffer.alloc(30));
   await writeFile(b, Buffer.alloc(30));
   await utimes(a, 1, 1);
   const temporary = `${key}.12345678-1234-1234-1234-123456789abc.tmp`;
   await writeFile(join(path, temporary), "partial");
   await writeFile(join(path, "unrelated.txt"), "keep");
   await pruneWaveforms(path, 40, true);
   expect((await readdir(path)).sort()).toEqual([`${"b".repeat(64)}.wave`, "unrelated.txt"]);
});
