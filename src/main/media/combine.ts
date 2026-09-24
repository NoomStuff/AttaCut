import { mkdtemp, writeFile } from "node:fs/promises";
import { publishOutput, removeTemporary } from "./publish.ts";
import { dirname, extname, join } from "node:path";
import type { ProbedSource } from "./probe.ts";
import { assertSourceUnchanged } from "./probe.ts";
import { exportCut } from "./cut.ts";
import type { CutAnalysis, CutOptions } from "./cut.ts";
import { ffmpegBase, runMedia } from "./process.ts";
import { isMp4Container, containerFlags } from "./formats.ts";
import { ffconcatList, isLosslessAudio, dispositionFlags, serializeChapters } from "./mux.ts";
import { verifyCopiedFrames, verifyOutputStructure, verifyEncodedFrames } from "./verify.ts";

export async function exportCombined(source: ProbedSource, cuts: CutAnalysis[], destination: string, options: CutOptions): Promise<void> {
   const temporary = await mkdtemp(join(dirname(destination), ".attacut-combined-"));
   const selectedAudio = source.streams.filter(
      (stream) => stream.type === "audio" && (options.audioTracks === undefined || options.audioTracks.includes(stream.index))
   );
   try {
      const paths: string[] = [];
      const duration = cuts.reduce((sum, cut) => sum + cut.clip.end - cut.clip.start, 0);
      for (const [index, cut] of cuts.entries()) {
         const rawPath = join(temporary, `raw-${index}${extname(destination)}`);
         const path = join(temporary, `clip-${index}${extname(destination)}`);
         // Verification of each cut happens on the concatenated output below, so the
         // intermediate files skip it instead of decoding every clip twice.
         await exportCut(source, cut, rawPath, {
            ...options,
            verify: false,
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
               ...(selectedAudio.length ? ["-bsf:a", `noise=drop='lt(pts*tb,0)+gte(pts*tb,${cut.clip.end - cut.clip.start})'`] : []),
               "-avoid_negative_ts",
               "disabled",
               path,
            ],
            { ...options, duration: cut.clip.end - cut.clip.start }
         );
         paths.push(path);
      }
      const list = join(temporary, "clips.ffconcat");
      await writeFile(
         list,
         ffconcatList(
            paths,
            cuts.map((cut) => cut.clip.end - cut.clip.start)
         )
      );
      const output = join(temporary, `combined${extname(destination)}`);
      // Separately trimmed lossless streams can carry encoder settings that differ between
      // clips. Concatenating those packets under the first clip's codec header corrupts the
      // result on stricter decoders. Re-encode these tracks losslessly at the final join so the
      // output has one consistent stream configuration.
      const joinedAudioCodecs = selectedAudio.flatMap((audio, index) => (isLosslessAudio(audio.codec) ? [`-c:a:${index}`, audio.codec] : []));
      const trackMetadata = (["audio", "subtitle"] as const).flatMap((type) =>
         source.streams
            .filter((stream) => stream.type === type && (type !== "audio" || selectedAudio.some((audio) => audio.index === stream.index)))
            .flatMap((stream, index) => {
               const specifier = `${type === "audio" ? "a" : "s"}:${index}`;
               return [`-map_metadata:s:${specifier}`, `1:s:${stream.index}`, `-disposition:${specifier}`, dispositionFlags(stream.disposition)];
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
      if (chapters.length) await writeFile(chapterPath, serializeChapters(chapters));
      const video = source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)!;
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
            `1:s:${video.index}`,
            "-c",
            "copy",
            ...joinedAudioCodecs,
            "-map_chapters",
            chapters.length ? "2" : "-1",
            ...(isMp4Container(extname(destination)) ? containerFlags(video) : []),
            "-t",
            String(duration),
            output,
         ],
         { ...options, duration }
      );
      let offset = 0;
      for (const cut of cuts) {
         if (cut.verifyTimes?.length) await verifyCopiedFrames(source, output, cut.clip.start - offset, cut.verifyTimes, options.signal);
         if (cut.encodedVerifyTimes?.length) await verifyEncodedFrames(source, output, cut.clip.start - offset, cut.encodedVerifyTimes, options.signal);
         offset += cut.clip.end - cut.clip.start;
      }
      options.signal?.throwIfAborted();
      await verifyOutputStructure(
         source,
         output,
         selectedAudio.map((stream) => stream.index),
         duration,
         options.signal,
         cuts[0]!.clip.start
      );
      await assertSourceUnchanged(source);
      await publishOutput(output, destination, options.overwrite, source.path, options.replaceSource);
   } finally {
      await removeTemporary(temporary);
   }
}
