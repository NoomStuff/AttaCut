import { withTemporaryOutput } from "./transaction";
import { primaryVideo } from "../../shared/types";
import { writeFile, copyFile, stat, constants } from "node:fs/promises";
import { publishOutput } from "./publish.ts";
import { join, extname, dirname, resolve } from "node:path";
import type { Clip, ExportPlanItem, StreamAssessment, ExportStage } from "../../shared/types.ts";
import type { ProbedSource, PacketPoint } from "./probe.ts";
import { packetsAround, assertSourceUnchanged, sourceFrames } from "./probe.ts";
import { lowerBound } from "../../shared/sorted";
import { ffmpegBase, runMedia } from "./process.ts";
import type { RunOptions } from "./process.ts";
import { metadataInputs, textSubtitleCodecs } from "./metadata.ts";
import { verifyCopiedFrames, verifyOutputStructure, verifyEncodedFrames } from "./verify.ts";
import {
   encoderArguments,
   isIntraCodec,
   segmentExtension,
   colorArguments,
   isMp4Container,
   containerFlags,
   containerKeepsData,
   supportsInterlacedEncoding,
} from "./formats.ts";
import { ffconcatList, isLosslessAudio, dispositionFlags } from "./mux.ts";
import { resolveFrameTime } from "../../shared/frames.ts";

export interface Span {
   start: number;
   end: number;
   encode: boolean;
   readStart?: number;
}
export interface CutAnalysis {
   frameCount?: number;
   frameDuration?: number;
   streams?: StreamAssessment[];
   changes?: string[];
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
   const analysis = await analyzeRange(source, clip, signal, intent);
   const frames = analysis.method === "unsupported" ? null : await sourceFrames(source, signal);
   const frameCount = frames ? lowerBound(frames, analysis.clip.end - epsilon) - lowerBound(frames, analysis.clip.start - epsilon) : undefined;
   let frameDuration = 0;
   if (analysis.execution === "trim" && analysis.method !== "unsupported") {
      const windows = await Promise.all([packetsAround(source, analysis.clip.start, signal), packetsAround(source, analysis.clip.end, signal)]);
      for (const points of windows)
         for (const [index, point] of points.entries())
            frameDuration = Math.max(frameDuration, point.duration ?? 0, Math.max(0, (points[index + 1]?.time ?? point.time) - point.time));
   }
   const extension = (intent.extension ?? source.exportExtension).toLowerCase();
   const changes = [...(analysis.changes ?? [])];
   const streams = source.streams.map((stream): StreamAssessment => {
      const result = (action: StreamAssessment["action"], reason: string): StreamAssessment => ({ index: stream.index, type: stream.type, action, reason });
      if (stream.type === "audio" && intent.audioTracks && !intent.audioTracks.includes(stream.index))
         return result("omit", "Excluded by your audio selection");
      if (analysis.method === "unsupported") return result("unsupported", analysis.message);
      if (analysis.execution === "file-copy") return result("copy", "Original file copied unchanged");
      if (stream.type === "data" && !containerKeepsData(extension)) return result("omit", "The output container cannot hold telemetry");
      if (analysis.execution === "remux" || stream.attachedPicture || stream.type === "attachment") return result("copy", "Original stream retained");
      if (stream.type === "video")
         return result(
            analysis.encodedSeconds ? "encode" : "trim",
            analysis.encodedSeconds
               ? analysis.spans.every((span) => span.encode)
                  ? "Encode selected frames for accurate cuts"
                  : "Encode cut boundaries and copy the remaining frames"
               : "Copy selected frames"
         );
      if (stream.type === "audio")
         return result(
            isLosslessAudio(stream.codec) ? "encode" : "trim",
            isLosslessAudio(stream.codec) ? "Trim and encode without audio quality loss" : "Copy selected audio packets"
         );
      if (stream.type === "subtitle" && textSubtitleCodecs.has(stream.codec)) {
         const codec = isMp4Container(extension) ? "mov_text" : extension === ".webm" ? "webvtt" : stream.codec === "mov_text" ? "subrip" : stream.codec;
         if (codec !== stream.codec) {
            changes.push("Subtitles change format. Some styling may not survive.");
            return result("convert", `Trim captions and convert ${stream.codec} to ${codec}`);
         }
         return result("trim", "Trim caption timing to the selected range");
      }
      return result("trim", "Retain content within the selected range");
   });
   return {
      ...analysis,
      streams,
      changes: [...new Set(changes)],
      ...(frameDuration > 0 ? { frameDuration } : {}),
      ...(frameCount !== undefined ? { frameCount } : {}),
   };
}
async function analyzeRange(source: ProbedSource, clip: Clip, signal?: AbortSignal, intent: CutIntent = {}): Promise<CutAnalysis> {
   const unsupported = (message: string): CutAnalysis => ({ execution: "trim", clip, spans: [], method: "unsupported", encodedSeconds: 0, message });
   if (clip.start < 0 || clip.end > source.duration + epsilon || clip.end <= clip.start) return unsupported("The selected range is outside the video.");
   const destination = (intent.extension ?? source.exportExtension).toLowerCase();
   const keepsData = containerKeepsData(destination);
   // Telemetry tracks ride along wherever the container can hold them; elsewhere they are
   // named as dropped instead of disappearing silently inside the muxer.
   const dataNote =
      source.streams.some((stream) => stream.type === "data") && !keepsData
         ? " This output container cannot store telemetry tracks, so they are left out."
         : "";
   if (clip.start === 0 && Math.abs(clip.end - source.duration) < epsilon) {
      const identical = !intent.combined && (intent.extension ?? source.extension).toLowerCase() === source.extension.toLowerCase();
      const fullCopy =
         identical &&
         source.streams
            .filter((stream) => stream.type === "audio")
            .every((stream) => intent.audioTracks === undefined || intent.audioTracks.includes(stream.index));
      return {
         execution: fullCopy ? "file-copy" : "remux",
         clip,
         spans: [{ start: 0, end: source.duration, encode: false }],
         method: "copy",
         encodedSeconds: 0,
         message: fullCopy || !dataNote ? "Original streams copied" : `Original streams copied.${dataNote}`,
         changes: fullCopy || !dataNote ? [] : [dataNote.trim()],
      };
   }
   const video = primaryVideo(source);
   if (!video) return unsupported("No video track.");
   if (source.streams.some((stream) => !["audio", "video", "subtitle", "attachment", "data"].includes(stream.type)))
      return unsupported("This file contains stream types that cannot yet be preserved during trimming.");
   if (source.streams.some((stream) => stream.type === "subtitle" && !textSubtitleCodecs.has(stream.codec) && destination !== ".mkv"))
      return unsupported("This file contains bitmap subtitles that cannot be stored in this output container yet.");
   if (source.streams.some((stream) => stream.attachedPicture) && intent.combined)
      return unsupported("Trimming files with embedded cover pictures into one combined video is not supported yet.");
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
   if (encodedSeconds > epsilon && !encoderArguments(video))
      return unsupported(`Precise boundary encoding is not available for ${video.codec.toUpperCase()} yet. Turn on Snap to keyframes to export losslessly.`);
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
   if (encodedSeconds > epsilon && video.fieldOrder && !["unknown", "progressive"].includes(video.fieldOrder) && !supportsInterlacedEncoding(video.codec))
      return unsupported("Precise boundary encoding for interlaced video is not supported yet.");
   return {
      execution: "trim",
      clip: snapped,
      spans,
      method: encodedSeconds > epsilon ? "boundary" : "copy",
      changes: dataNote ? [dataNote.trim()] : [],
      encodedSeconds,
      message:
         (encodedSeconds > epsilon ? `${encodedSeconds.toFixed(2)}s near the cuts re-encoded; remaining video copied` : "Original streams copied") + dataNote,
      verifyTimes,
      encodedVerifyTimes,
   };
}

export interface CutOptions extends RunOptions {
   audioTracks?: number[];
   overwrite?: boolean;
   replaceSource?: boolean;
   /** Skip output verification; the combined path verifies the concatenated result itself. */
   verify?: boolean;
   onStage?: (stage: ExportStage) => void;
}
export async function exportCut(source: ProbedSource, analysis: CutAnalysis, destination: string, options: CutOptions = {}): Promise<void> {
   if (analysis.method === "unsupported") throw new Error(analysis.message);
   destination = resolve(destination);
   await assertSourceUnchanged(source);
   return withTemporaryOutput(dirname(destination), ".attacut-", async (temporary) => {
      const finalTemporary = join(temporary, `output${extname(destination)}`);
      const { clip } = analysis;
      const duration = clip.end - clip.start;
      const sourceAudio = source.streams.filter((stream) => stream.type === "audio");
      const selectedAudio = options.audioTracks === undefined ? sourceAudio : sourceAudio.filter((stream) => options.audioTracks!.includes(stream.index));
      const allAudio = selectedAudio.length === sourceAudio.length;
      // Matroska-family muxers silently drop data streams, so their absence is expected by verification.
      const keepsData = containerKeepsData(extname(destination).toLowerCase());
      options.onStage?.(analysis.method === "boundary" ? "encoding" : "copying");
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
               ...(keepsData ? [] : ["-map", "-0:d?"]),
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
         const video = primaryVideo(source)!;
         const segmentPaths: string[] = [];
         const weight = (span: Span) => (span.end - span.start) * (span.encode ? 4 : 1);
         const totalWork = analysis.spans.reduce((sum, span) => sum + weight(span), duration);
         let finishedWork = 0;
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
            // The bounds carry the same epsilon slack as the copy filter below, so both span
            // kinds treat boundary frames identically regardless of how each tool rounds
            // timestamps internally.
            if (span.encode)
               args.push(
                  "-vf",
                  `trim=start=${absoluteStart - epsilon}:end=${absoluteEnd - epsilon},setpts=PTS-round(${absoluteStart}/TB)`,
                  ...encoderArguments(video)!
               );
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
               onProgress: (fraction) => options.onProgress?.((0.9 * (finishedWork + weight(span) * fraction)) / totalWork),
            });
            // ffmpeg exits 0 even when the trim let nothing through, and the empty segment
            // only surfaces later as a cryptic concat failure. Name the cut instead.
            const written = await stat(path).catch(() => null);
            if (!written || written.size === 0) throw new Error("No video frames were produced for this cut. Try a nearby cut or turn on Snap to keyframes.");
            finishedWork += weight(span);
            segmentPaths.push(path);
         }
         const listPath = join(temporary, "parts.ffconcat");
         await writeFile(
            listPath,
            ffconcatList(
               segmentPaths,
               analysis.spans.map((span) => span.end - span.start)
            )
         );
         const metadata = await metadataInputs(
            source,
            clip,
            temporary,
            destination,
            options.signal,
            selectedAudio.map((audio) => audio.index)
         );
         const audioPreroll = analysis.spans[0]?.readStart ?? 0;
         const covers = source.streams.filter((stream) => stream.attachedPicture);
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
            // Telemetry follows the audio treatment: copied from the pre-seeked input and
            // bounded by the output duration. Cover pictures join as secondary video streams.
            ...source.streams.filter((stream) => stream.type === "data" && keepsData).flatMap((stream) => ["-map", `1:${stream.index}`]),
            ...covers.flatMap((stream, index) => ["-map", `1:${stream.index}`, "-disposition:v:" + (index + 1), dispositionFlags(stream.disposition)]),
            "-map_metadata",
            "1",
            "-map_metadata:s:v:0",
            `1:s:${video.index}`,

            "-c",
            "copy",
            "-t",
            String(duration),
         ];
         if (isMp4Container(extname(destination))) args.push(...containerFlags(video));
         else {
            args.push("-bsf:a", `noise=drop='lt(pts*tb,0)+gte(pts*tb,${duration})'`, "-avoid_negative_ts", "disabled");
            if (source.streams.some((stream) => stream.type === "subtitle" && !textSubtitleCodecs.has(stream.codec)))
               args.push("-bsf:s", `noise=drop='lt(pts*tb,0)+gte(pts*tb,${duration})'`);
         }
         for (const [index, audio] of selectedAudio.entries()) {
            if (isLosslessAudio(audio.codec)) {
               args.push(`-c:a:${index}`, audio.codec, `-filter:a:${index}`, `atrim=start=0:end=${duration}`, `-bsf:a:${index}`, "null");
            }
         }
         args.push(...metadata.outputs, ...colorArguments(video), "-progress", "pipe:1", finalTemporary);
         await runMedia("ffmpeg", args, {
            ...options,
            duration,
            onProgress: (fraction) => options.onProgress?.((0.9 * (finishedWork + duration * fraction)) / totalWork),
         });
      }
      options.signal?.throwIfAborted();
      if (options.verify ?? true) {
         options.onStage?.("checking");
         options.onProgress?.(0.92);
         if (analysis.execution !== "file-copy" || !allAudio || extname(destination).toLowerCase() !== source.extension.toLowerCase())
            await verifyOutputStructure(
               source,
               finalTemporary,
               selectedAudio.map((stream) => stream.index),
               duration,
               options.signal,
               clip.start,
               keepsData ? [] : ["data"],
               analysis.frameDuration,
               analysis.frameCount
            );
         if (analysis.verifyTimes?.length) await verifyCopiedFrames(source, finalTemporary, clip.start, analysis.verifyTimes, options.signal);
         if (analysis.encodedVerifyTimes?.length) await verifyEncodedFrames(source, finalTemporary, clip.start, analysis.encodedVerifyTimes, options.signal);
      }
      await assertSourceUnchanged(source);
      options.onStage?.("saving");
      options.onProgress?.(0.98);
      await publishOutput(finalTemporary, destination, options.overwrite, source.path, options.replaceSource);
      options.onProgress?.(1);
   });
}
