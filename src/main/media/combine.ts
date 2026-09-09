import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { publishOutput } from "./publish.ts";
import { dirname, extname, join } from "node:path";
import type { ProbedSource } from "./probe.ts";
import { exportCut } from "./cut.ts";
import type { CutAnalysis, CutOptions } from "./cut.ts";
import { ffmpegBase, runMedia } from "./process.ts";
import { verifyCopiedFrames } from "./verify.ts";

export async function exportCombined(source: ProbedSource, cuts: CutAnalysis[], destination: string, options: CutOptions): Promise<void> {
   const temporary = await mkdtemp(join(dirname(destination), ".attacut-combined-"));
   try {
      const paths: string[] = [];
      const duration = cuts.reduce((sum, cut) => sum + cut.clip.end - cut.clip.start, 0);
      for (const [index, cut] of cuts.entries()) {
         const rawPath = join(temporary, `raw-${index}${extname(destination)}`);
         const path = join(temporary, `clip-${index}${extname(destination)}`);
         await exportCut(source, cut, rawPath, {
            ...options,
            onProgress: (fraction) => options.onProgress?.((index + fraction) / (cuts.length + 1)),
         });
         // Remove audio hidden by edit lists before concatenation; otherwise its
         // preroll can overlap the preceding clip by seconds.
         await runMedia(
            "ffmpeg",
            [
               ...ffmpegBase,
               "-copyts",
               "-i",
               rawPath,
               "-map",
               "0:v",
               "-map",
               "0:a?",
               "-map",
               "0:s?",
               "-c",
               "copy",
               ...(!options.muteAudio && source.streams.some((stream) => stream.type === "audio")
                  ? ["-bsf:a", `noise=drop='lt(pts*tb,0)+gte(pts*tb,${cut.clip.end - cut.clip.start})'`]
                  : []),
               "-avoid_negative_ts",
               "disabled",
               path,
            ],
            options
         );
         paths.push(path);
      }
      const list = join(temporary, "clips.ffconcat");
      await writeFile(
         list,
         `ffconcat version 1.0\n${paths.map((path, index) => `file '${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\nduration ${cuts[index]!.clip.end - cuts[index]!.clip.start}`).join("\n")}\n`
      );
      const output = join(temporary, `combined${extname(destination)}`);
      const trackMetadata = (["audio", "subtitle"] as const).flatMap((type) =>
         source.streams
            .filter((stream) => stream.type === type && !(type === "audio" && options.muteAudio))
            .flatMap((stream, index) => {
               const specifier = `${type === "audio" ? "a" : "s"}:${index}`;
               return [
                  `-map_metadata:s:${specifier}`,
                  `1:s:${stream.index}`,
                  `-disposition:${specifier}`,
                  Object.entries(stream.disposition)
                     .filter(([, value]) => value === 1)
                     .map(([name]) => name)
                     .join("+") || "0",
               ];
            })
      );
      let chapterOffset = 0;
      const chapters = cuts.flatMap((cut) => {
         const result = source.chapters
            .filter((chapter) => chapter.end > cut.clip.start && chapter.start < cut.clip.end)
            .map((chapter) => ({
               start: chapterOffset + Math.max(chapter.start, cut.clip.start) - cut.clip.start,
               end: chapterOffset + Math.min(chapter.end, cut.clip.end) - cut.clip.start,
               title: chapter.title,
            }));
         chapterOffset += cut.clip.end - cut.clip.start;
         return result;
      });
      const chapterPath = join(temporary, "chapters.ffmetadata");
      if (chapters.length)
         await writeFile(
            chapterPath,
            `;FFMETADATA1\n${chapters.map((chapter) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.start * 1000)}\nEND=${Math.round(chapter.end * 1000)}\ntitle=${chapter.title.replace(/[\\=;#\n\r]/g, (char) => `\\${char}`)}\n`).join("")}`
         );
      await runMedia(
         "ffmpeg",
         [
            ...ffmpegBase,
            "-copyts",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            list,
            "-i",
            source.path,
            ...(chapters.length ? ["-f", "ffmetadata", "-i", chapterPath] : []),
            "-map",
            "0",
            ...source.streams
               .filter((stream) => stream.type === "attachment")
               .flatMap((stream, index) => ["-map", `1:${stream.index}`, `-map_metadata:s:t:${index}`, `1:s:${stream.index}`]),
            "-map_metadata",
            "1",
            ...trackMetadata,
            "-map_metadata:s:v:0",
            `1:s:${source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)!.index}`,
            "-c",
            "copy",
            "-map_chapters",
            chapters.length ? "2" : "-1",
            ...(options.muteAudio ? ["-an"] : []),
            ...([".mp4", ".mov", ".m4v"].includes(extname(destination)) ? ["-movflags", "+faststart"] : []),
            "-t",
            String(duration),
            output,
         ],
         options
      );
      let offset = 0;
      for (const cut of cuts) {
         if (cut.verifyTimes?.length) await verifyCopiedFrames(source, output, cut.clip.start - offset, cut.verifyTimes, options.signal);
         offset += cut.clip.end - cut.clip.start;
      }
      options.signal?.throwIfAborted();
      await publishOutput(output, destination);
   } finally {
      await rm(temporary, { recursive: true, force: true });
   }
}
