import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProbedSource } from "./probe.ts";
import { ffmpegBase, runMedia } from "./process.ts";
import type { RunOptions } from "./process.ts";
import { probeSource } from "./probe.ts";
import { isHdrTransfer, tonemapToBt709 } from "./formats.ts";
import { removeTemporary } from "./publish.ts";
const previewByteLimit = 1024 * 1024 * 1024;

/**
 * Cache id stays stable across opens of the same unchanged file, so reopening a recording
 * reuses its preview instead of re-copying or re-encoding it. The key trusts the same
 * signals as assertSourceUnchanged: file identity plus size and mtime. File names are hashed
 * rather than embedded so odd characters never reach a URL or path.
 */
function previewId(source: ProbedSource, audioKey: string, transcode: boolean): string {
   const file = createHash("sha1").update(source.path.toLowerCase()).digest("hex").slice(0, 12);
   return `${file}-${source.size.toString(36)}-${Math.round(source.modified).toString(36)}-${audioKey}-${transcode ? "proxy" : "remux"}`;
}

/** Startup pruning: keep the newest previews across sessions and sweep interrupted runs. */
export async function prunePreviews(folder: string, keep = 2): Promise<void> {
   const entries = await readdir(folder).catch(() => [] as string[]);
   for (const name of entries.filter((name) => name.startsWith("preparing-")))
      await rm(join(folder, name), { recursive: true, force: true }).catch(() => undefined);
   const previews = (
      await Promise.all(
         entries
            .filter((name) => name.endsWith(".mp4"))
            .map(async (name) => {
               const path = join(folder, name);
               const stats = await stat(path).catch(() => null);
               return stats ? { path, modified: stats.mtimeMs } : null;
            })
      )
   ).filter((item): item is { path: string; modified: number } => item !== null);
   previews.sort((a, b) => b.modified - a.modified);
   for (const stale of previews.slice(keep)) await rm(stale.path, { force: true }).catch(() => undefined);
}

export async function preparePreview(
   source: ProbedSource,
   folder: string,
   audioIndices: number[],
   transcode: boolean,
   options: RunOptions
): Promise<{ id: string; path: string }> {
   await mkdir(folder, { recursive: true });
   const audioKey = audioIndices.length ? audioIndices.join("-") : "silent";
   const id = previewId(source, audioKey, transcode);
   const path = join(folder, `${id}.mp4`);
   if (existsSync(path)) return { id, path };
   const temporary = await mkdtemp(join(folder, "preparing-"));
   const partial = join(temporary, "preview.mp4");
   const video = source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)!;
   const hdr = isHdrTransfer(video.colorTransfer);
   const primaries = ["", "unknown", "unspecified"].includes(video.colorPrimaries) ? "bt2020" : video.colorPrimaries;
   const space = ["", "unknown", "unspecified"].includes(video.colorSpace) ? "bt2020nc" : video.colorSpace;
   const toneMap = hdr ? `${tonemapToBt709("yuv420p", `zscale=pin=${primaries}:tin=${video.colorTransfer}:min=${space}`)},` : "";
   const encode = [
      "-vf",
      `${toneMap}scale=w='trunc(min(1280,iw)/2)*2':h=-2`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "25",
      "-pix_fmt",
      "yuv420p",
      ...(hdr ? ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"] : []),
   ];
   const run = (convertVideo: boolean) =>
      runMedia(
         "ffmpeg",
         [
            ...ffmpegBase,
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
            ...(audioIndices.length ? ["-c:a", "aac"] : []),
            "-movflags",
            "+faststart",
            "-fs",
            String(previewByteLimit),
            "-progress",
            "pipe:1",
            partial,
         ],
         { ...options, duration: source.duration }
      );
   try {
      options.onProgress?.(0);
      try {
         await run(transcode);
      } catch (error) {
         if (options.signal?.aborted || transcode) throw error;
         await run(true);
      }
      options.signal?.throwIfAborted();
      const preview = await probeSource(partial, options.signal);
      if ((await stat(partial)).size >= previewByteLimit || preview.duration < source.duration - 0.25)
         throw new Error("This preview exceeds the cache limit. The original can still be exported.");
      await rename(partial, path);
      return { id, path };
   } finally {
      await removeTemporary(temporary);
   }
}
