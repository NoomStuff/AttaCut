import { primaryVideo } from "../../shared/types";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, rm, stat, readFile, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import type { ProbedSource } from "./probe.ts";
import { ffmpegBase, runMedia } from "./process.ts";
import type { RunOptions } from "./process.ts";
import { probeSource } from "./probe.ts";
import { isHdrTransfer, tonemapToBt709 } from "./formats.ts";
import { removeTemporary } from "./publish.ts";
/** All cached and unfinished previews share this disk limit. */
const previewByteLimit = 8 * 1024 * 1024 * 1024;
const longRecordingSeconds = 2 * 60 * 60;
const leases = new Set<string>();
let preparation: Promise<unknown> = Promise.resolve();
let toolVersion: Promise<string> | null = null;
function previewToolVersion(): Promise<string> {
   if (!toolVersion)
      toolVersion = runMedia("ffmpeg", ["-version"], { priority: "background" }).catch((error: unknown) => {
         toolVersion = null;
         throw error;
      });
   return toolVersion;
}

export function leasePreview(path: string): void {
   leases.add(path);
}
export function releasePreview(path: string): void {
   leases.delete(path);
}

/**
 * Cache id stays stable across opens of the same unchanged file, so reopening a recording
 * reuses its preview instead of re-copying or re-encoding it. The key trusts the same
 * signals as assertSourceUnchanged: file identity plus size and mtime. File names are hashed
 * rather than embedded so odd characters never reach a URL or path.
 */
function previewId(source: ProbedSource, audioKey: string, transcode: boolean, tool: string): string {
   return createHash("sha256")
      .update(
         JSON.stringify([
            3,
            process.platform === "win32" ? source.path.toLowerCase() : source.path,
            source.size,
            source.modified,
            source.fileIdentity,
            audioKey,
            transcode,
            tool,
         ])
      )
      .digest("hex");
}

/** Startup pruning: keep the newest previews across sessions and sweep interrupted runs. */
export async function prunePreviews(folder: string, keep = 2, startup = true, byteLimit = previewByteLimit): Promise<void> {
   const entries = await readdir(folder).catch(() => [] as string[]);
   for (const name of entries.filter((name) => startup && name.startsWith("preparing-")))
      await rm(join(folder, name), { recursive: true, force: true }).catch(() => undefined);
   const previews = (
      await Promise.all(
         entries
            .filter((name) => name.endsWith(".mp4"))
            .map(async (name) => {
               const path = join(folder, name);
               const stats = await stat(path).catch(() => null);
               const manifest = await stat(`${path}.json`).catch(() => null);
               return stats ? { path, modified: manifest?.mtimeMs ?? stats.mtimeMs, size: stats.size } : null;
            })
      )
   ).filter((item): item is { path: string; modified: number; size: number } => item !== null);
   previews.sort((a, b) => b.modified - a.modified);
   let bytes = previews.filter((preview) => leases.has(preview.path)).reduce((sum, preview) => sum + preview.size, 0);
   let retained = 0;
   for (const preview of previews) {
      if (leases.has(preview.path)) continue;
      if (retained < keep && bytes + preview.size <= byteLimit) {
         bytes += preview.size;
         retained++;
         continue;
      }
      await rm(preview.path, { force: true }).catch(() => undefined);
      await rm(`${preview.path}.json`, { force: true }).catch(() => undefined);
   }
}

export async function preparePreview(
   source: ProbedSource,
   folder: string,
   audioIndices: number[],
   transcode: boolean,
   options: RunOptions
): Promise<{ id: string; path: string }> {
   // One cache writer at a time makes the disk budget include unfinished output.
   const work = preparation.catch(() => undefined).then(() => preparePreviewFile(source, folder, audioIndices, transcode, options));
   preparation = work;
   return work;
}

async function preparePreviewFile(
   source: ProbedSource,
   folder: string,
   audioIndices: number[],
   transcode: boolean,
   options: RunOptions
): Promise<{ id: string; path: string }> {
   options.signal?.throwIfAborted();
   await mkdir(folder, { recursive: true });
   const audioKey = audioIndices.length ? audioIndices.join("-") : "silent";
   const id = previewId(source, audioKey, transcode, await previewToolVersion());
   const path = join(folder, `${id}.mp4`);
   try {
      const [info, manifest] = await Promise.all([
         stat(path),
         readFile(`${path}.json`, "utf8").then((text) => JSON.parse(text) as { id: string; size: number; modified: number; duration: number }),
      ]);
      if (manifest.id === id && manifest.size === info.size && manifest.modified === info.mtimeMs && Math.abs(manifest.duration - source.duration) <= 0.25) {
         const now = new Date();
         await utimes(`${path}.json`, now, now);
         return { id, path };
      }
   } catch {
      /* An interrupted or older cache is rebuilt below. */
   }
   await prunePreviews(folder, 0, false);
   // Count actual files too. A Windows decoder may briefly prevent eviction.
   const remaining = (await readdir(folder)).flatMap((name) =>
      name.endsWith(".mp4") ? [join(folder, name)] : name.startsWith("preparing-") ? [join(folder, name, "preview.mp4")] : []
   );
   const used = (await Promise.all(remaining.map(async (file) => (await stat(file).catch(() => null))?.size ?? 0))).reduce((sum, size) => sum + size, 0);
   const available = previewByteLimit - used;
   if (available <= 0) throw new Error("The preview cache is full. Close this recording before preparing another preview.");
   const temporary = await mkdtemp(join(folder, "preparing-"));
   const partial = join(temporary, "preview.mp4");
   const video = primaryVideo(source)!;
   const hdr = isHdrTransfer(video.colorTransfer);
   const primaries = ["", "unknown", "unspecified"].includes(video.colorPrimaries) ? "bt2020" : video.colorPrimaries;
   const space = ["", "unknown", "unspecified"].includes(video.colorSpace) ? "bt2020nc" : video.colorSpace;
   const toneMap = hdr ? `${tonemapToBt709("yuv420p", `zscale=pin=${primaries}:tin=${video.colorTransfer}:min=${space}`)},` : "";
   // Interlaced previews are deinterlaced for viewing only; the source and every export stay untouched.
   const deinterlace = video.fieldOrder && !["unknown", "progressive"].includes(video.fieldOrder) ? "yadif=2:-1:0," : "";
   const long = source.duration > longRecordingSeconds;
   const audioBitrate = audioIndices.length
      ? Math.max(128000, ...source.streams.filter((stream) => audioIndices.includes(stream.index)).map((stream) => (stream.channels || 2) * 64000))
      : 0;
   // Reserve container overhead and encoder bursts. CRF remains the quality target;
   // VBV prevents a long recording from exhausting the budget at the end of encoding.
   const videoBitrate = Math.floor(Math.min(8_000_000, (available * 8 * 0.85) / source.duration - audioBitrate));
   const previewWidth = videoBitrate < 500000 ? 640 : long ? 960 : 1280;
   const encode = [
      "-vf",
      `${toneMap}${deinterlace}scale=w='trunc(min(${previewWidth},iw)/2)*2':h=-2`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      long ? "26" : "25",
      "-maxrate",
      String(videoBitrate),
      "-bufsize",
      String(videoBitrate * 2),
      "-g",
      String(Math.max(12, Math.min(120, Math.round((video.frameRate || 30) * 2)))),
      "-pix_fmt",
      "yuv420p",
      ...(hdr ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] : []),
   ];
   const run = (convertVideo: boolean, hardwareDecode: boolean) =>
      runMedia(
         "ffmpeg",
         [
            ...ffmpegBase,
            ...(hardwareDecode ? ["-hwaccel", "auto"] : []),
            "-i",
            source.path,
            "-map",
            `0:${video.index}`,
            ...(audioIndices.length === 0
               ? ["-an"]
               : audioIndices.length === 1
                 ? ["-map", `0:${audioIndices[0]}`]
                 : [
                      "-filter_complex",
                      `${audioIndices.map((index) => `[0:${index}]`).join("")}amix=inputs=${audioIndices.length}:duration=longest[a]`,
                      "-map",
                      "[a]",
                   ]),
            ...(convertVideo ? encode : ["-c:v", "copy"]),
            ...(audioIndices.length ? ["-c:a", "aac", "-b:a", String(audioBitrate)] : []),
            "-movflags",
            "+faststart",
            "-fs",
            String(available),
            "-progress",
            "pipe:1",
            partial,
         ],
         { ...options, priority: "background", duration: source.duration }
      );
   const runWithDecodeFallback = async (convertVideo: boolean) => {
      if (convertVideo && videoBitrate < 100000)
         throw new Error("This recording cannot fit a usable preview in the cache. The original can still be exported.");
      // Some drivers advertise a decoder but lose the device partway through a proxy.
      // Retry in software so preview availability does not depend on that driver.
      const hardwareDecode = convertVideo && process.platform !== "linux";
      try {
         await run(convertVideo, hardwareDecode);
      } catch (error) {
         if (
            options.signal?.aborted ||
            !hardwareDecode ||
            !/cuda|cuvid|nvdec|d3d11|dxva|videotoolbox|vulkan|VK_ERROR_DEVICE_LOST|hwaccel|hardware|device.*(?:failed|error)/i.test(String(error))
         )
            throw error;
         await run(convertVideo, false);
      }
   };
   try {
      options.onProgress?.(0);
      try {
         await runWithDecodeFallback(transcode);
      } catch (error) {
         if (
            options.signal?.aborted ||
            transcode ||
            !/codec.*not.*supported|could not find tag|not currently supported in container|incompatible.*(?:codec|container)|invalid.*(?:codec|tag)/i.test(
               String(error)
            )
         )
            throw error;
         await runWithDecodeFallback(true);
      }
      options.signal?.throwIfAborted();
      const preview = await probeSource(partial, options.signal);
      if ((await stat(partial)).size >= available || preview.duration < source.duration - 0.25)
         throw new Error("This preview exceeds the cache limit. The original can still be exported.");
      await rename(partial, path);
      const info = await stat(path);
      await writeFile(`${path}.json.tmp`, JSON.stringify({ id, size: info.size, modified: info.mtimeMs, duration: preview.duration }));
      await rename(`${path}.json.tmp`, `${path}.json`);
      return { id, path };
   } finally {
      await removeTemporary(temporary);
   }
}
