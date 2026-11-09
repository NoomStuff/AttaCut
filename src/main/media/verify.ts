import { audioStreams, primaryVideo } from "../../shared/types";
import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";
import { probeSource, sourceFrames, ratio } from "./probe.ts";
import { isLosslessAudio } from "./mux";
import type { MediaStream } from "../../shared/types";

function audioPacketDuration(stream: MediaStream, copied = false): number {
   // Copied lossless packets end on their own block boundaries, up to about a tenth of a second.
   if (isLosslessAudio(stream.codec)) return copied ? 0.1 : 1 / (stream.sampleRate || 48000);
   const samples =
      stream.codec === "aac" ? 1024 : stream.codec === "mp3" ? 1152 : ["ac3", "eac3"].includes(stream.codec) ? 1536 : stream.codec === "opus" ? 960 : 2048;
   return samples / (stream.sampleRate || 48000);
}

/** Check the promised stream inventory before making an output visible. */
export async function verifyOutputStructure(
   source: ProbedSource,
   output: string,
   audioTracks: number[],
   duration: number,
   signal?: AbortSignal,
   start = 0,
   ignoreTypes: readonly string[] = [],
   videoFrameDuration?: number,
   expectedFrameCount?: number,
   expectation: { excludedStreams?: number[]; rotation?: number; copiedAudio?: boolean } = {}
): Promise<ProbedSource> {
   const actual = await probeSource(output, signal);
   const expected = source.streams.filter(
      (stream) =>
         (stream.type !== "audio" || audioTracks.includes(stream.index)) &&
         !ignoreTypes.includes(stream.type) &&
         !expectation.excludedStreams?.includes(stream.index) &&
         !stream.chapterTrack
   );
   const primary = primaryVideo(source)?.index;
   for (const type of new Set([...expected, ...actual.streams].map((stream) => stream.type))) {
      const before = expected.filter((stream) => stream.type === type);
      const after = actual.streams.filter((stream) => stream.type === type && !stream.chapterTrack);
      if (before.length !== after.length) throw new Error(`The export did not preserve the expected ${type} tracks. No output was published.`);
      for (const [index, stream] of before.entries()) {
         const result = after[index]!;
         if (
            type === "attachment" &&
            source.attachmentHashes?.[stream.index] &&
            source.attachmentHashes[stream.index] !== actual.attachmentHashes?.[result.index]
         )
            throw new Error("The export changed an attachment. No output was published.");
         if (stream.attachedPicture) {
            if (!result.attachedPicture || (await preservedPictureHash(source, stream.index, signal)) !== (await pictureHash(output, result.index, signal)))
               throw new Error("The export changed a cover image. No output was published.");
         }
         if ((type === "video" || type === "audio") && stream.codec !== result.codec)
            throw new Error(`The export changed a ${type} codec. No output was published.`);
         if (
            type === "video" &&
            (stream.width !== result.width ||
               stream.height !== result.height ||
               stream.pixelFormat !== result.pixelFormat ||
               (stream.index === primary && expectation.rotation !== undefined ? expectation.rotation : stream.rotation) !== result.rotation)
         )
            throw new Error("The export changed the video format. No output was published.");
         if (
            type === "video" &&
            stream.sampleAspectRatio &&
            !["N/A", "0:1"].includes(stream.sampleAspectRatio) &&
            stream.sampleAspectRatio !== result.sampleAspectRatio
         )
            throw new Error("The export changed video pixel proportions. No output was published.");
         if (
            type === "audio" &&
            ((stream.sampleRate && stream.sampleRate !== result.sampleRate) ||
               (stream.channels && stream.channels !== result.channels) ||
               (stream.channelLayout && stream.channelLayout !== result.channelLayout))
         )
            throw new Error("The export changed the audio format. No output was published.");
         if ((type === "audio" || type === "subtitle") && stream.language && stream.language !== "und" && stream.language !== result.language)
            throw new Error("The export changed track language metadata. No output was published.");
         if (type === "audio" && stream.startTime !== undefined && result.startTime !== undefined) {
            const expectedStart = Math.max(0, stream.startTime - source.startOffset - start);
            const actualStart = Math.max(0, result.startTime - actual.startOffset);
            if (
               expectedStart < duration &&
               Math.abs(expectedStart - actualStart) >
                  Math.max(audioPacketDuration(stream, expectation.copiedAudio), ratio(stream.timeBase), ratio(result.timeBase)) * 2 + 0.0001
            )
               throw new Error("The export changed audio timing. No output was published.");
         }
         if (type === "video") {
            for (const key of ["colorTransfer", "colorPrimaries", "colorSpace", "colorRange", "masterDisplay", "maxCll"] as const) {
               const value = stream[key];
               if (value && value !== "unknown" && value !== "unspecified" && value !== result[key])
                  throw new Error("The export changed video color metadata. No output was published.");
            }
         }
      }
   }
   const video = primaryVideo(source);
   const frameDuration = videoFrameDuration ?? (video?.frameRate ? 1 / video.frameRate : 0);
   const packetDuration = Math.max(
      0,
      ...expected.filter((stream) => stream.type === "audio").map((stream) => audioPacketDuration(stream, expectation.copiedAudio))
   );
   const tolerance = Math.max(frameDuration * 2, packetDuration * 2) + 0.002;
   if (Math.abs(actual.duration - duration) > tolerance) throw new Error("The exported duration does not match the selected clips. No output was published.");
   if (expectedFrameCount !== undefined) {
      const frames = await sourceFrames(actual, signal);
      if (frames && frames.length !== expectedFrameCount)
         throw new Error("The exported frame count does not match the selected clips. No output was published.");
   }
   return actual;
}

const referenceHashes = new WeakMap<ProbedSource, Map<number, string>>();
const pictureHashes = new WeakMap<ProbedSource, Map<number, string>>();
async function pictureHash(path: string, index: number, signal?: AbortSignal): Promise<string> {
   const result = await runMedia(
      "ffmpeg",
      ["-v", "error", "-i", path, "-map", `0:${index}`, "-c", "copy", "-frames:v", "1", "-f", "hash", "-hash", "sha256", "-"],
      { signal }
   );
   const hash = /^SHA256=([a-f0-9]{64})$/m.exec(result)?.[1];
   if (!hash) throw new Error("Could not verify the cover image. No output was published.");
   return hash;
}
async function preservedPictureHash(source: ProbedSource, index: number, signal?: AbortSignal): Promise<string> {
   let cache = pictureHashes.get(source);
   const cached = cache?.get(index);
   if (cached) return cached;
   const hash = await pictureHash(source.path, index, signal);
   signal?.throwIfAborted();
   if (!cache) {
      cache = new Map();
      pictureHashes.set(source, cache);
   }
   cache.set(index, hash);
   return hash;
}
interface FrameCheck {
   time: number;
   encoded: boolean;
}

/** Share decoding between nearby checks, with at most ten seconds between endpoints
 * and eight checks per graph. Distant cuts never cause a scan across the recording. */
export async function verifyCutFrames(
   source: ProbedSource,
   output: ProbedSource,
   start: number,
   copiedTimes: number[] = [],
   encodedTimes: number[] = [],
   signal?: AbortSignal
): Promise<void> {
   const checks: FrameCheck[] = [
      ...[...new Set(copiedTimes)].map((time) => ({ time, encoded: false })),
      ...[...new Set(encodedTimes)].map((time) => ({ time, encoded: true })),
   ].sort((a, b) => a.time - b.time);
   let group: FrameCheck[] = [];
   for (const check of checks) {
      if (group.length && (group.length >= 8 || check.time - group[0]!.time > 10)) {
         await verifyFrameGroup(source, output, start, group, signal);
         group = [];
      }
      group.push(check);
   }
   if (group.length) await verifyFrameGroup(source, output, start, group, signal);
}

async function verifyFrameGroup(source: ProbedSource, output: ProbedSource, start: number, checks: FrameCheck[], signal?: AbortSignal): Promise<void> {
   signal?.throwIfAborted();
   let references = referenceHashes.get(source);
   if (!references) {
      references = new Map();
      referenceHashes.set(source, references);
   }
   const sourceChecks = checks.filter((check) => check.encoded || !references.has(check.time));
   const args = ["-v", "error", "-copyts", "-filter_complex_threads", "1"];
   const input = (path: string, time: number) => {
      const seek = Math.max(0, time - 5);
      // Resolution changes must not reset the one-frame trim counters in each branch.
      args.push(...(seek > 0 ? ["-ss", String(seek)] : []), "-noautorotate", "-reinit_filter", "0", "-i", path);
   };
   if (sourceChecks.length) input(source.path, sourceChecks[0]!.time);
   input(output.path, checks[0]!.time - start);
   const graph: string[] = [];
   const sourceFormat = primaryVideo(source)!.pixelFormat;
   const outputFormat = primaryVideo(output)!.pixelFormat;
   // Pin each decoder's native format before splitting. SSIM may need a color
   // conversion, but that conversion must never affect the exact copied-frame hashes.
   if (sourceChecks.length)
      graph.push(`[0:V:0]format=pix_fmts=${sourceFormat},split=${sourceChecks.length}${sourceChecks.map((_, index) => `[source${index}]`).join("")}`);
   graph.push(
      `[${sourceChecks.length ? 1 : 0}:V:0]format=pix_fmts=${outputFormat},split=${checks.length}${checks.map((_, index) => `[output${index}]`).join("")}`
   );
   const maps: string[] = [];
   let streams = 0;
   const map = (label: string, format?: string) => {
      const index = streams++;
      maps.push("-map", `[${label}]`, `-threads:v:${index}`, "1");
      if (format) maps.push(`-pix_fmt:v:${index}`, format);
      return index;
   };
   const copies: { time: number; source: number | null; output: number }[] = [];
   const encoded: number[] = [];
   for (const [index, check] of checks.entries()) {
      const reference = sourceChecks.indexOf(check);
      // Each branch ends after its first selected frame. A failed quality check
      // cannot silently accept a later frame or keep decoding until the file ends.
      const frame = (label: string, time: number, target: string) =>
         graph.push(`[${label}]trim=start=${Math.max(0, time - 0.0011)},trim=end_frame=1,setpts=PTS-STARTPTS[${target}]`);
      if (reference >= 0) frame(`source${reference}`, check.time + source.startOffset, `a${index}`);
      frame(`output${index}`, check.time - start, `b${index}`);
      if (check.encoded) {
         graph.push(`[a${index}][b${index}]ssim,metadata=mode=select:key=lavfi.ssim.All:value=0.9:function=expr:expr='gte(VALUE1,VALUE2)'[quality${index}]`);
         encoded.push(map(`quality${index}`));
      } else copies.push({ time: check.time, source: reference >= 0 ? map(`a${index}`, sourceFormat) : null, output: map(`b${index}`, outputFormat) });
   }
   const result = await runMedia("ffmpeg", [...args, "-filter_complex", graph.join(";"), ...maps, "-an", "-fps_mode", "passthrough", "-f", "framemd5", "-"], {
      signal,
   }).catch((error: unknown) => {
      // FFmpeg can reject a multi-stream hash output when one selected frame is
      // absent. This is a failed frame check, not an encoder setting the user can fix.
      if (error instanceof Error && /Could not open encoder before EOF|at least one of its streams received no packets/.test(error.message))
         throw new Error(
            encoded.length
               ? "An encoded boundary did not match the selected source frame. No output was published."
               : "Could not verify a frame at the cut. The partial export was removed.",
            { cause: error }
         );
      throw error;
   });
   signal?.throwIfAborted();
   const hashes = new Map<number, string>();
   for (const line of result.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const fields = line.split(",").map((field) => field.trim());
      const index = Number(fields[0]);
      if (fields.length !== 6 || !Number.isInteger(index) || index < 0 || index >= streams || !/^[a-f0-9]{32}$/i.test(fields[5]!) || hashes.has(index))
         throw new Error("Could not verify a frame at the cut. The partial export was removed.");
      hashes.set(index, fields[5]!);
   }
   for (const check of copies) {
      const original = check.source === null ? references.get(check.time) : hashes.get(check.source);
      const copy = hashes.get(check.output);
      if (!original || !copy) throw new Error("Could not verify a frame at the cut. The partial export was removed.");
      if (original !== copy)
         throw new Error(
            "This file's frame dependencies could not be joined without changing copied video. Try a shorter clip. The partial export was removed."
         );
      references.set(check.time, original);
      if (references.size > 128) references.delete(references.keys().next().value!);
   }
   if (encoded.some((index) => !hashes.has(index))) throw new Error("An encoded boundary did not match the selected source frame. No output was published.");
}

/**
 * Bitstream filters that bring both sides to one packet layout before hashing. Containers
 * store H.264 and HEVC as length-prefixed or start-code NAL units and may add parameter sets,
 * and MPEG-TS wraps AAC in ADTS headers. None of that is picture or sound data.
 */
function packetNormalizer(stream: MediaStream, side: "source" | "output"): string | null {
   if (stream.codec === "h264") return "h264_mp4toannexb,filter_units=pass_types=1-5";
   if (stream.codec === "hevc") return "hevc_mp4toannexb,filter_units=pass_types=0-31";
   if (stream.codec === "av1") return "filter_units=remove_types=2";
   if (stream.codec === "aac") return "aac_adtstoasc";
   // Copied MPEG-4 Part 2 segments repeat their headers on keyframes; do the same to the source.
   if (stream.codec === "mpeg4" && side === "source") return "dump_extra=freq=keyframe";
   return null;
}
async function packetHashes(
   path: string,
   streams: MediaStream[],
   side: "source" | "output",
   range: { start: number; end: number } | null,
   signal?: AbortSignal
): Promise<string[][]> {
   const hashes = streams.map(() => [] as string[]);
   const args = ["-v", "error", "-nostdin"];
   if (range) args.push(...(range.start > 3 ? ["-ss", String(range.start - 3)] : []), "-t", String(range.end - Math.max(0, range.start - 3) + 3));
   args.push("-i", path);
   for (const [index, stream] of streams.entries()) {
      args.push("-map", `0:${stream.index}`);
      const filter = packetNormalizer(stream, side);
      if (filter) args.push(`-bsf:${index}`, filter);
   }
   args.push("-c", "copy", "-f", "framemd5", "-");
   await runMedia("ffmpeg", args, {
      signal,
      priority: "export",
      onLines: (line) => {
         if (line.startsWith("#")) return;
         const fields = line.split(",").map((field) => field.trim());
         const stream = hashes[Number(fields[0])];
         if (stream && fields[5]) stream.push(fields[5]);
      },
   });
   return hashes;
}
/** Whether `part` appears in order inside `whole`, allowing skipped packets in between. */
export function isPacketSubsequence(part: readonly string[], whole: readonly string[]): boolean {
   let position = 0;
   for (const hash of part) {
      while (position < whole.length && whole[position] !== hash) position++;
      if (position === whole.length) return false;
      position++;
   }
   return true;
}

/**
 * Force lossless promises that every picture and sound packet in the output is an untouched
 * source packet. Hash each one and require the output to be the source's packets, in order,
 * with only the parts outside the cuts left out. PCM is skipped: containers regroup raw
 * samples into different packet sizes, and copying uncompressed audio cannot change it.
 */
export async function verifyLosslessPackets(
   source: ProbedSource,
   output: ProbedSource,
   ranges: { start: number; end: number }[],
   audioTracks: number[],
   signal?: AbortSignal
): Promise<void> {
   const video = primaryVideo(source);
   const outputVideo = primaryVideo(output);
   const pairs: { source: MediaStream; output: MediaStream }[] = [];
   if (video && outputVideo) pairs.push({ source: video, output: outputVideo });
   const outputAudio = audioStreams(output);
   source.streams
      .filter((stream) => stream.type === "audio" && audioTracks.includes(stream.index))
      .forEach((stream, index) => {
         if (outputAudio[index] && !stream.codec.startsWith("pcm_")) pairs.push({ source: stream, output: outputAudio[index] });
      });
   if (!pairs.length) return;
   const exported = await packetHashes(
      output.path,
      pairs.map((pair) => pair.output),
      "output",
      null,
      signal
   );
   const original = pairs.map(() => [] as string[]);
   for (const range of ranges) {
      const hashes = await packetHashes(
         source.path,
         pairs.map((pair) => pair.source),
         "source",
         range,
         signal
      );
      hashes.forEach((list, index) => original[index]!.push(...list));
   }
   signal?.throwIfAborted();
   for (const [index, pair] of pairs.entries()) {
      if (!exported[index]!.length || !isPacketSubsequence(exported[index]!, original[index]!))
         throw new Error(`The exported ${pair.source.type} is not an exact copy of the source, so the export is not fully lossless. No output was published.`);
   }
}
