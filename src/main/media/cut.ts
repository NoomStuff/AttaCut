import { mkdtemp, writeFile, rm, copyFile, constants } from "node:fs/promises";
import { publishOutput } from "./publish.ts";
import { join, extname, dirname, resolve } from "node:path";
import type { Clip, ExportPlanItem } from "../../shared/types.ts";
import type { ProbedSource, PacketPoint } from "./probe.ts";
import { packetsAround, assertSourceUnchanged } from "./probe.ts";
import { ffmpegBase, runMedia } from "./process.ts";
import type { RunOptions } from "./process.ts";
import { metadataInputs, textSubtitleCodecs } from "./metadata.ts";
import { verifyCopiedFrames, verifyOutputStructure, verifyEncodedFrames } from "./verify.ts";
import { encoderArguments, isIntraCodec, segmentExtension, colorArguments } from "./formats.ts";
import { resolveFrameTime } from "../../shared/frames.ts";

export interface Span {
   start: number;
   end: number;
   encode: boolean;
   readStart?: number;
}
export interface CutAnalysis {
   execution: "file-copy" | "remux" | "trim";
   clip: Clip;
   spans: Span[];
   method: ExportPlanItem["method"];
   encodedSeconds: number;
   message: string;
   verifyTimes?: number[];
   encodedVerifyTimes?: number[];
}
const epsilon = 0.0001;
function closestFrame(points: PacketPoint[], time: number, duration: number): number {
   return resolveFrameTime(
      points.map((point) => point.time),
      time,
      duration
   );
}
export interface CutIntent {
   audioTracks?: number[];
   extension?: string;
   combined?: boolean;
}
export async function analyzeCut(source: ProbedSource, clip: Clip, signal?: AbortSignal, intent: CutIntent = {}): Promise<CutAnalysis> {
   const unsupported = (message: string): CutAnalysis => ({ execution: "trim", clip, spans: [], method: "unsupported", encodedSeconds: 0, message });
   if (clip.start < 0 || clip.end > source.duration + epsilon || clip.end <= clip.start) return unsupported("The selected range is outside the video.");
   if (clip.start === 0 && Math.abs(clip.end - source.duration) < epsilon) {
      return {
         execution:
            !intent.combined &&
            (intent.extension ?? source.extension).toLowerCase() === source.extension.toLowerCase() &&
            source.streams
               .filter((stream) => stream.type === "audio")
               .every((stream) => intent.audioTracks === undefined || intent.audioTracks.includes(stream.index))
               ? "file-copy"
               : "remux",
         clip,
         spans: [{ start: 0, end: source.duration, encode: false }],
         method: "copy",
         encodedSeconds: 0,
         message: "Original streams copied",
      };
   }
   const video = source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture);
   if (!video) return unsupported("No video track.");
   if (source.streams.some((stream) => !["audio", "video", "subtitle", "attachment"].includes(stream.type)))
      return unsupported("This file contains timed data tracks that cannot yet be preserved during trimming.");
   if (source.streams.some((stream) => stream.type === "subtitle" && !textSubtitleCodecs.has(stream.codec)))
      return unsupported("This file contains bitmap subtitles that cannot yet be trimmed reliably.");
   if (source.streams.some((stream) => stream.attachedPicture)) return unsupported("Trimming files with embedded cover pictures is not supported yet.");
   if (source.streams.filter((stream) => stream.type === "video" && !stream.attachedPicture).length !== 1)
      return unsupported("Cutting files with multiple video tracks is not supported yet.");
   const [startPackets, endPackets] = await Promise.all([packetsAround(source, clip.start, signal), packetsAround(source, clip.end, signal)]);
   if (!startPackets.length || !endPackets.length) return unsupported("This file has no usable frame timestamps near the selected cuts.");
   const snapped = {
      ...clip,
      start: closestFrame(startPackets, clip.start, source.duration),
      end: closestFrame(endPackets, clip.end, source.duration),
   };
   if (snapped.end - snapped.start < 0.001) return unsupported("This selection is shorter than one video frame.");
   const allIntra = isIntraCodec(video.codec) || [...startPackets, ...endPackets].every((packet) => packet.key);
   const nextKey = startPackets.find((packet) => packet.key && packet.time >= snapped.start - epsilon)?.time;
   const previousKey = endPackets.filter((packet) => packet.key && packet.time <= snapped.end + epsilon).at(-1)?.time;
   const copyStart = Math.max(snapped.start, nextKey ?? snapped.end);
   const joinKey = endPackets.find((packet) => packet.key && packet.time === previousKey);
   const dependent = joinKey ? endPackets.filter((packet) => packet.time < joinKey.time && packet.dts >= joinKey.dts).map((packet) => packet.time) : [];
   const safeEnd = dependent.length ? Math.min(...dependent) : previousKey;
   const copyEnd = Math.min(snapped.end, Math.abs(snapped.end - source.duration) < epsilon ? source.duration : (safeEnd ?? snapped.start));
   const spans: Span[] = [];
   if (allIntra) spans.push({ start: snapped.start, end: snapped.end, encode: false });
   else if (copyEnd <= copyStart + epsilon) spans.push({ start: snapped.start, end: snapped.end, encode: true });
   else {
      if (copyStart > snapped.start + epsilon) spans.push({ start: snapped.start, end: copyStart, encode: true });
      spans.push({ start: copyStart, end: copyEnd, encode: false });
      if (copyEnd < snapped.end - epsilon) spans.push({ start: copyEnd, end: snapped.end, encode: true });
   }
   // MPEG-4 Part 2 VOP clocks do not join reliably across separately encoded segments.
   // A short clip can be encoded safely; a longer conversion stays subject to the normal limit.
   if (video.codec === "mpeg4" && spans.some((span) => span.encode)) spans.splice(0, spans.length, { start: snapped.start, end: snapped.end, encode: true });
   const points = [...startPackets, ...endPackets].sort((a, b) => a.time - b.time);
   for (const span of spans) span.readStart = Math.max(0, (points.filter((point) => point.key && point.time <= span.start).at(-1)?.time ?? 0) - 1);
   const verifyTimes = [
      ...new Set(
         spans
            .filter((span) => !span.encode)
            .flatMap((span) => {
               const frames = [
                  ...new Set(points.filter((point) => point.time >= span.start - epsilon && point.time < span.end - epsilon).map((point) => point.time)),
               ];
               return [...frames.slice(0, 2), ...frames.slice(-2)];
            })
      ),
   ];
   const encodedSeconds = spans.filter((span) => span.encode).reduce((sum, span) => sum + span.end - span.start, 0);
   const encodedVerifyTimes = [
      ...new Set(
         spans
            .filter((span) => span.encode)
            .flatMap((span) => {
               const frames = points.filter((point) => point.time >= span.start - epsilon && point.time < span.end - epsilon);
               return frames.length ? [frames[0]!.time, frames.at(-1)!.time] : [];
            })
      ),
   ];
   if (encodedSeconds > 12 || (snapped.end - snapped.start > 12 && encodedSeconds > (snapped.end - snapped.start) * 0.5)) {
      return unsupported("This cut would need more than a small section re-encoded. Try a nearby boundary or a shorter selection.");
   }
   if (encodedSeconds > epsilon && !encoderArguments(video))
      return unsupported(`Precise boundary encoding is not available for ${video.codec.toUpperCase()} yet.`);
   if (encodedSeconds > epsilon && ["mpeg4", "mpeg2video", "mpeg1video", "wmv1", "wmv2"].includes(video.codec)) {
      const interval = 1 / video.frameRate;
      const irregular = [startPackets, endPackets].some((packets) =>
         packets.some((point, index) => index > 0 && Math.abs(point.time - packets[index - 1]!.time - interval) > 0.002)
      );
      if (irregular) return unsupported(`Precise cuts for variable-timing ${video.codec.toUpperCase()} video are not supported yet.`);
   }
   if (encodedSeconds > epsilon && video.dynamicHdr)
      return unsupported("This file uses dynamic HDR metadata. Encoding its cuts without changing HDR is not supported yet.");
   if (encodedSeconds > epsilon && video.codec !== "hevc" && (video.masterDisplay || video.maxCll))
      return unsupported("Preserving this codec's HDR mastering metadata during boundary encoding is not supported yet.");
   if (encodedSeconds > epsilon && video.fieldOrder && !["unknown", "progressive"].includes(video.fieldOrder))
      return unsupported("Precise boundary encoding for interlaced video is not supported yet.");
   return {
      execution: "trim",
      clip: snapped,
      spans,
      method: encodedSeconds > epsilon ? "boundary" : "copy",
      encodedSeconds,
      message: encodedSeconds > epsilon ? `${encodedSeconds.toFixed(2)}s near the cuts re-encoded; remaining video copied` : "Original streams copied",
      verifyTimes,
      encodedVerifyTimes,
   };
}

export interface CutOptions extends RunOptions {
   audioTracks?: number[];
   overwrite?: boolean;
}
export async function exportCut(source: ProbedSource, analysis: CutAnalysis, destination: string, options: CutOptions = {}): Promise<void> {
   if (analysis.method === "unsupported") throw new Error(analysis.message);
   destination = resolve(destination);
   await assertSourceUnchanged(source);
   const temporary = await mkdtemp(join(dirname(destination), ".attacut-"));
   const finalTemporary = join(temporary, `output${extname(destination)}`);
   const { clip } = analysis;
   const duration = clip.end - clip.start;
   const sourceAudio = source.streams.filter((stream) => stream.type === "audio");
   const selectedAudio = options.audioTracks === undefined ? sourceAudio : sourceAudio.filter((stream) => options.audioTracks!.includes(stream.index));
   const allAudio = selectedAudio.length === sourceAudio.length;
   try {
      if (analysis.execution === "file-copy" && allAudio && extname(destination).toLowerCase() === source.extension.toLowerCase()) {
         await copyFile(source.path, finalTemporary, constants.COPYFILE_EXCL);
      } else if (clip.start === 0 && Math.abs(clip.end - source.duration) < epsilon) {
         // A whole-source remux preserves every non-audio stream, including secondary video,
         // cover art, attachments and data. Unsupported container mappings fail explicitly.
         await runMedia(
            "ffmpeg",
            [
               ...ffmpegBase,
               "-i",
               source.path,
               "-map",
               "0",
               ...sourceAudio.filter((stream) => !selectedAudio.includes(stream)).flatMap((stream) => ["-map", `-0:${stream.index}`]),
               "-map_metadata",
               "0",
               "-map_chapters",
               "0",
               "-c",
               "copy",
               finalTemporary,
            ],
            options
         );
      } else {
         const video = source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)!;
         const segmentPaths: string[] = [];
         for (const [index, span] of analysis.spans.entries()) {
            options.signal?.throwIfAborted();
            const segmentType = segmentExtension(video.codec);
            const path = join(temporary, `part-${index}${segmentType}`);
            const preroll = span.readStart ?? Math.max(0, span.start - 5);
            const absoluteStart = span.start + source.startOffset;
            const absoluteEnd = span.end + source.startOffset;
            const args = [
               ...ffmpegBase,
               "-copyts",
               "-fflags",
               "+genpts",
               ...(preroll > 0 ? ["-ss", String(preroll)] : []),
               "-t",
               String(span.end - preroll + 2),
               "-noautorotate",
               "-i",
               source.path,
               "-map",
               `0:${video.index}`,
               "-an",
            ];
            if (span.encode)
               args.push("-vf", `trim=start=${absoluteStart}:end=${absoluteEnd},setpts=PTS-round(${absoluteStart}/TB)`, ...encoderArguments(video)!);
            else
               args.push(
                  "-c:v",
                  "copy",
                  "-bsf:v",
                  `noise=drop='lt(pts*tb,${absoluteStart - epsilon})+gte(pts*tb,${absoluteEnd - epsilon})',setts=pts=PTS-${absoluteStart}/TB:dts=DTS-${absoluteStart}/TB`
               );
            args.push("-t", String(span.encode ? span.end - span.start : absoluteEnd));
            if (video.codec === "mpeg4" && !span.encode)
               args.push(
                  "-bsf:v",
                  `noise=drop='lt(pts*tb,${absoluteStart - epsilon})+gte(pts*tb,${absoluteEnd - epsilon})',setts=pts=PTS-${absoluteStart}/TB:dts=DTS-${absoluteStart}/TB,dump_extra=freq=keyframe`
               );
            args.push("-avoid_negative_ts", segmentType === ".ts" ? "make_zero" : "disabled");
            if (segmentType === ".ts") args.push("-mpegts_flags", "+resend_headers", "-f", "mpegts");
            args.push("-progress", "pipe:1", path);
            await runMedia("ffmpeg", args, {
               ...options,
               duration: span.end - span.start,
               onProgress: (fraction) => options.onProgress?.((index + fraction) / (analysis.spans.length + 1)),
            });
            segmentPaths.push(path);
         }
         const listPath = join(temporary, "parts.ffconcat");
         await writeFile(
            listPath,
            `ffconcat version 1.0\n${segmentPaths.map((path, index) => `file '${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\nduration ${analysis.spans[index]!.end - analysis.spans[index]!.start}`).join("\n")}\n`
         );
         const metadata = await metadataInputs(
            { ...source, streams: source.streams.filter((stream) => stream.type !== "audio" || selectedAudio.some((audio) => audio.index === stream.index)) },
            clip,
            temporary,
            destination,
            options.signal
         );
         const audioPreroll = analysis.spans[0]?.readStart ?? 0;
         const args = [
            ...ffmpegBase,
            "-f",
            "concat",
            "-safe",
            "0",
            "-display_rotation:v:0",
            String(video.rotation),
            "-i",
            listPath,
            ...(audioPreroll > 0 ? ["-ss", String(audioPreroll)] : []),
            "-itsoffset",
            String(-(clip.start - audioPreroll)),
            "-i",
            source.path,
            ...metadata.inputs,
            "-map",
            "0:v:0",
            ...selectedAudio.flatMap((audio) => ["-map", `1:${audio.index}`]),
            "-map_metadata",
            "1",
            "-map_metadata:s:v:0",
            `1:s:${video.index}`,

            "-c",
            "copy",
            "-t",
            String(duration),
         ];
         if ([".mp4", ".mov", ".m4v"].includes(extname(destination).toLowerCase()))
            args.push("-movflags", "+faststart", ...(video.codec === "hevc" ? ["-tag:v", "hvc1"] : []));
         else args.push("-bsf:a", `noise=drop='lt(pts*tb,0)+gte(pts*tb,${duration})'`, "-avoid_negative_ts", "disabled");
         for (const [index, audio] of selectedAudio.entries()) {
            if (["flac", "alac", "wavpack"].includes(audio.codec) || audio.codec.startsWith("pcm_")) {
               args.push(`-c:a:${index}`, audio.codec, `-filter:a:${index}`, `atrim=start=0:end=${duration}`, `-bsf:a:${index}`, "null");
            }
         }
         args.push(...metadata.outputs, ...colorArguments(video), "-progress", "pipe:1", finalTemporary);
         await runMedia("ffmpeg", args, {
            ...options,
            duration,
            onProgress: (fraction) => options.onProgress?.((analysis.spans.length + fraction) / (analysis.spans.length + 1)),
         });
      }
      options.signal?.throwIfAborted();
      if (analysis.execution !== "file-copy" || !allAudio || extname(destination).toLowerCase() !== source.extension.toLowerCase())
         await verifyOutputStructure(
            source,
            finalTemporary,
            selectedAudio.map((stream) => stream.index),
            duration,
            options.signal,
            clip.start
         );
      if (analysis.verifyTimes?.length) await verifyCopiedFrames(source, finalTemporary, clip.start, analysis.verifyTimes, options.signal);
      if (analysis.encodedVerifyTimes?.length) await verifyEncodedFrames(source, finalTemporary, clip.start, analysis.encodedVerifyTimes, options.signal);
      await publishOutput(finalTemporary, destination, options.overwrite, source.path);
      options.onProgress?.(1);
   } finally {
      await rm(temporary, { recursive: true, force: true });
   }
}
