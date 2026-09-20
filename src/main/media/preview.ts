import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProbedSource } from "./probe.ts";
import { ffmpegBase, runMedia } from "./process.ts";
import type { RunOptions } from "./process.ts";
import { probeSource } from "./probe.ts";
const previewByteLimit = 1024 * 1024 * 1024;

export async function preparePreview(
   source: ProbedSource,
   folder: string,
   audioIndices: number[],
   transcode: boolean,
   options: RunOptions
): Promise<{ id: string; path: string }> {
   await mkdir(folder, { recursive: true });
   const audioKey = audioIndices.length ? audioIndices.join("-") : "silent";
   const id = `${source.id}-${audioKey}-${transcode ? "proxy" : "remux"}`;
   const path = join(folder, `${id}.mp4`);
   if (existsSync(path)) return { id, path };
   const temporary = await mkdtemp(join(folder, "preparing-"));
   const partial = join(temporary, "preview.mp4");
   const video = source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)!;
   const hdr = ["smpte2084", "arib-std-b67"].includes(video.colorTransfer);
   const primaries = ["", "unknown", "unspecified"].includes(video.colorPrimaries) ? "bt2020" : video.colorPrimaries;
   const space = ["", "unknown", "unspecified"].includes(video.colorSpace) ? "bt2020nc" : video.colorSpace;
   const toneMap = hdr
      ? `zscale=pin=${primaries}:tin=${video.colorTransfer}:min=${space}:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,`
      : "";
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
      await rm(temporary, { recursive: true, force: true });
   }
}
