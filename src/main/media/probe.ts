import { primaryVideo } from "../../shared/types";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MediaSource } from "../../shared/types.ts";
import { runMedia } from "./process.ts";
import { outputExtension, isHdrTransfer } from "./formats.ts";
import { indexedSampleTimes } from "./mp4-index.ts";
import type { SampleTimes } from "./mp4-index.ts";
import { indexedMkvKeyframes } from "./mkv-index.ts";
import { waitForWork } from "./shared-work";

const numberLike = z.union([z.string(), z.number()]).optional();
const probeSchema = z.object({
   format: z.object({ duration: numberLike, start_time: numberLike }),
   streams: z.array(
      z.object({
         index: z.number(),
         codec_type: z.string().optional(),
         codec_name: z.string().optional(),
         extradata_hash: z.string().optional(),
         sample_rate: numberLike,
         channels: z.number().optional(),
         channel_layout: z.string().optional(),
         sample_aspect_ratio: z.string().optional(),
         start_time: numberLike,
         duration: numberLike,
         width: z.number().optional(),
         height: z.number().optional(),
         pix_fmt: z.string().optional(),
         profile: z.string().optional(),
         avg_frame_rate: z.string().optional(),
         r_frame_rate: z.string().optional(),
         time_base: z.string().optional(),
         color_transfer: z.string().optional(),
         color_primaries: z.string().optional(),
         color_space: z.string().optional(),
         color_range: z.string().optional(),
         chroma_location: z.string().optional(),
         field_order: z.string().optional(),
         disposition: z.record(z.string(), z.number()).optional(),
         side_data_list: z.array(z.record(z.string(), z.unknown())).optional(),
         tags: z.record(z.string(), z.string()).optional(),
      })
   ),
   chapters: z.array(z.object({ start_time: z.string(), end_time: z.string(), tags: z.record(z.string(), z.string()).optional() })).default([]),
});
export function ratio(value: string): number {
   const [a, b] = value.split("/").map(Number);
   return a && b ? a / b : 0;
}
export function isDynamicHdrMetadata(type: unknown): boolean {
   return /dovi|dolby|dynamic.*hdr|hdr.*dynamic|smpte\s*2094/i.test(String(type));
}
export function streamTitle(tags: Record<string, string> = {}): string {
   const normalized = Object.fromEntries(Object.entries(tags).map(([key, value]) => [key.toLowerCase(), value.trim()]));
   const title = normalized["title"] || normalized["name"];
   if (title) return title;
   const handler = normalized["handler_name"] ?? "";
   return /^(sound|audio|video)handler$/i.test(handler) ? "" : handler;
}
export interface ProbedSource extends MediaSource {
   attachmentHashes?: Record<number, string>;
   startOffset: number;
   fileIdentity?: { device: number; inode: number };
}
export async function probeSource(path: string, signal?: AbortSignal): Promise<ProbedSource> {
   const fullPath = resolve(path);
   const info = await stat(fullPath);
   if (!info.isFile()) throw new Error("Choose a video file.");
   const result = probeSchema.parse(
      JSON.parse(
         await runMedia("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-show_chapters", "-show_data_hash", "sha256", "-of", "json", fullPath], {
            signal,
         })
      )
   );
   const duration = Number(result.format.duration);
   if (!Number.isFinite(duration) || duration <= 0) throw new Error("This file has no usable video duration.");
   const id = randomUUID();
   const streams = result.streams.map((stream) => ({
      index: stream.index,
      startTime: Number(stream.start_time ?? result.format.start_time) || 0,
      type: stream.codec_type ?? "unknown",
      codec: stream.codec_name ?? "unknown",
      sampleRate: Number(stream.sample_rate) || 0,
      channels: stream.channels ?? 0,
      // Matroska PCM can omit a layout label. One and two channels still have
      // unambiguous mono/stereo defaults; do not guess multichannel ordering.
      channelLayout: stream.channel_layout ?? (stream.channels === 1 ? "mono" : stream.channels === 2 ? "stereo" : ""),
      sampleAspectRatio: stream.sample_aspect_ratio ?? "",
      title: stream.codec_type === "audio" ? streamTitle(stream.tags) : (stream.tags?.["title"] ?? ""),
      language: stream.tags?.["language"] ?? "",
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      pixelFormat: stream.pix_fmt ?? "",
      profile: stream.profile ?? "",
      timeBase: stream.time_base ?? "",
      frameRate: ratio(stream.avg_frame_rate ?? "") || ratio(stream.r_frame_rate ?? ""),
      colorTransfer: stream.color_transfer ?? "",
      colorPrimaries: stream.color_primaries ?? "",
      colorSpace: stream.color_space ?? "",
      colorRange: stream.color_range ?? "",
      chromaLocation: stream.chroma_location ?? "",
      rotation: Number(stream.side_data_list?.find((item) => item["side_data_type"] === "Display Matrix")?.["rotation"]) || 0,
      fieldOrder: stream.field_order ?? "",
      masterDisplay: "",
      maxCll: "",
      dynamicHdr: stream.side_data_list?.some((item) => isDynamicHdrMetadata(item["side_data_type"])) ?? false,
      attachedPicture: stream.disposition?.["attached_pic"] === 1,
      disposition: stream.disposition ?? {},
   }));
   const video = streams.find((stream) => stream.type === "video" && !stream.attachedPicture);
   if (
      video &&
      (isHdrTransfer(video.colorTransfer) ||
         ["bt2020", "bt2020nc", "bt2020c"].includes(video.colorPrimaries || video.colorSpace) ||
         /(?:10|12|16)(?:le|be)$/.test(video.pixelFormat))
   ) {
      const frameData = z
         .object({
            frames: z.array(
               z.object({
                  color_transfer: z.string().optional(),
                  color_primaries: z.string().optional(),
                  color_space: z.string().optional(),
                  color_range: z.string().optional(),
                  side_data_list: z.array(z.record(z.string(), z.unknown())).optional(),
               })
            ),
         })
         .parse(
            JSON.parse(
               await runMedia(
                  "ffprobe",
                  ["-v", "error", "-select_streams", String(video.index), "-read_intervals", "%+1", "-show_frames", "-of", "json", fullPath],
                  { signal }
               )
            )
         );
      // Some demuxers expose HDR descriptors only on decoded frames, not stream headers.
      const first = frameData.frames[0];
      if (first) {
         for (const [key, field] of [
            ["colorTransfer", "color_transfer"],
            ["colorPrimaries", "color_primaries"],
            ["colorSpace", "color_space"],
            ["colorRange", "color_range"],
         ] as const)
            if ((!video[key] || ["unknown", "unspecified"].includes(video[key])) && first[field]) video[key] = first[field];
      }
      const sideData = frameData.frames.flatMap((frame) => frame.side_data_list ?? []);
      const mastering = sideData.find((item) => item["side_data_type"] === "Mastering display metadata");
      const cll = sideData.find((item) => item["side_data_type"] === "Content light level metadata");
      if (mastering) {
         const n = (key: string, factor: number) => Math.round(ratio(String(mastering[key])) * factor);
         video.masterDisplay = `G(${n("green_x", 50000)},${n("green_y", 50000)})B(${n("blue_x", 50000)},${n("blue_y", 50000)})R(${n("red_x", 50000)},${n("red_y", 50000)})WP(${n("white_point_x", 50000)},${n("white_point_y", 50000)})L(${n("max_luminance", 10000)},${n("min_luminance", 10000)})`;
      }
      if (cll) video.maxCll = `${Number(cll["max_content"])},${Number(cll["max_average"])}`;
      video.dynamicHdr ||= sideData.some((item) => isDynamicHdrMetadata(item["side_data_type"]));
   }
   if (!video || video.width <= 0) throw new Error("This file does not contain a video track.");
   // Still images probe as a one-frame video stream at a nominal rate. Nothing trimmable
   // fits in under two frames, so refuse the import instead of letting export discover it.
   {
      const frames = video.frameRate > 0 ? duration * video.frameRate : duration < 0.1 ? 1 : Infinity;
      if (frames < 1.5) throw new Error("This file is a still image, not a video.");
   }
   const startOffset = Number(result.format.start_time) || 0;
   const videoDuration = Number(result.streams.find((stream) => stream.index === video.index)?.duration);
   const videoStart = video.startTime - startOffset;
   return {
      id,
      primaryVideoIndex: video.index,
      ...(Number.isFinite(videoDuration) && videoDuration > 0 ? { videoInterval: { start: Math.max(0, videoStart), end: videoStart + videoDuration } } : {}),
      path: fullPath,
      name: basename(fullPath),
      directory: dirname(fullPath),
      extension: extname(fullPath),
      exportExtension: outputExtension({ extension: extname(fullPath) }),
      duration,
      size: info.size,
      modified: info.mtimeMs,
      fileIdentity: { device: info.dev, inode: info.ino },
      attachmentHashes: Object.fromEntries(
         result.streams.filter((stream) => stream.codec_type === "attachment" && stream.extradata_hash).map((stream) => [stream.index, stream.extradata_hash!])
      ),
      streams,
      url: `media://source/${id}`,
      startOffset,
      chapters: result.chapters.map((chapter) => ({
         start: Number(chapter.start_time),
         end: Number(chapter.end_time),
         title: chapter.tags?.["title"] ?? "",
         tags: chapter.tags ?? {},
      })),
   };
}
export async function assertSourceUnchanged(source: MediaSource): Promise<void> {
   const info = await stat(source.path);
   const identity = (source as ProbedSource).fileIdentity;
   if (info.size !== source.size || info.mtimeMs !== source.modified || (identity && (info.dev !== identity.device || info.ino !== identity.inode)))
      throw new Error("The original file changed. Reopen it before exporting.");
}
const packetSchema = z.object({
   packets: z.array(
      z.object({ pts_time: z.string().optional(), dts_time: z.string().optional(), duration_time: z.string().optional(), flags: z.string().optional() })
   ),
});
export interface PacketPoint {
   duration?: number;
   time: number;
   key: boolean;
   dts: number;
}
const sampleIndexes = new WeakMap<ProbedSource, Promise<SampleTimes | null>>();
const reopenedIndexes = new Map<string, SampleTimes>();
const indexBudget = 64 * 1024 * 1024;
function indexBytes(index: SampleTimes): number {
   return (index.frames?.buffer.byteLength ?? 0) + (index.keyframes.buffer === index.frames?.buffer ? 0 : index.keyframes.buffer.byteLength);
}
const sourceLifetimes = new WeakMap<ProbedSource, AbortSignal>();
export function setSourceLifetime(source: ProbedSource, signal: AbortSignal): void {
   sourceLifetimes.set(source, signal);
}
/** Opening and keyframe snapping share the same MP4 table parse. */
function sampleTimes(source: ProbedSource, signal?: AbortSignal): Promise<SampleTimes | null> {
   let cached = sampleIndexes.get(source);
   if (!cached) {
      const identity = JSON.stringify([
         process.platform === "win32" ? source.path.toLowerCase() : source.path,
         source.size,
         source.modified,
         source.fileIdentity,
         source.startOffset,
         source.duration,
      ]);
      const reusable = reopenedIndexes.get(identity);
      if (reusable) {
         reopenedIndexes.delete(identity);
         reopenedIndexes.set(identity, reusable);
      }
      cached = (reusable ? Promise.resolve(reusable) : indexedSampleTimes(source, sourceLifetimes.get(source)))
         .then((index) => {
            if (index && indexBytes(index) <= indexBudget) {
               reopenedIndexes.set(identity, index);
               while ([...reopenedIndexes.values()].reduce((sum, value) => sum + indexBytes(value), 0) > indexBudget)
                  reopenedIndexes.delete(reopenedIndexes.keys().next().value!);
            }
            return index;
         })
         .catch((error: unknown) => {
            if (sampleIndexes.get(source) === cached) sampleIndexes.delete(source);
            throw error;
         });
      sampleIndexes.set(source, cached);
   }
   return waitForWork(cached, signal);
}
export async function sourceKeyframes(source: ProbedSource, signal?: AbortSignal): Promise<number[]> {
   const index = await sampleTimes(source, signal);
   if (index) return Array.from(index.keyframes);
   const cued = await indexedMkvKeyframes(source, signal);
   if (cued) return cued;
   const times = new Set<number>();
   await runMedia(
      "ffprobe",
      [
         "-v",
         "error",
         "-fflags",
         "+genpts",
         "-select_streams",
         String(primaryVideo(source)!.index),
         "-show_packets",
         "-show_entries",
         "packet=pts_time,flags",
         "-of",
         "csv=p=0",
         source.path,
      ],
      {
         signal,
         // This scan reads every packet in the file, so its output must not be buffered;
         priority: "background",
         // multi-hour recordings index as a stream instead of hitting the memory cap.
         onLines: (line) => {
            if (!line.includes("K")) return;
            const time = Number(line.split(",")[0]) - source.startOffset;
            if (Number.isFinite(time) && time >= 0 && time <= source.duration) times.add(time);
         },
      }
   );
   return [...times].sort((a, b) => a - b);
}
/**
 * Presentation time of every frame for MP4-family sources, read once from the sample tables.
 * Lets seeks resolve in memory; null means the container needs packet windows instead.
 */
export function sourceFrames(source: ProbedSource, signal?: AbortSignal): Promise<Float64Array | number[] | null> {
   return sampleTimes(source, signal).then((index) => index?.frames ?? null);
}
const packetWindows = new WeakMap<ProbedSource, Map<number, { points: number; value: Promise<PacketPoint[]> }>>();
const seekWindows = new WeakMap<ProbedSource, Map<number, { points: number; value: Promise<PacketPoint[]> }>>();
/**
 * Packet timestamps around one time. Analysis windows span 30 seconds with a long read so cut
 * decisions see full GOP structure; seek windows stay small so the first scrub into a new
 * region of a long recording does not wait on a large demux.
 */
export async function packetsAround(source: ProbedSource, time: number, signal?: AbortSignal, mode: "analysis" | "seek" = "analysis"): Promise<PacketPoint[]> {
   signal?.throwIfAborted();
   const window = mode === "seek" ? 12 : 30;
   const read = mode === "seek" ? 16 : 95;
   const cacheMap = mode === "seek" ? seekWindows : packetWindows;
   // Analysis windows start a window before the time so cut prerolls land inside; seek windows
   // only need to contain the target with a small forward margin for frame stepping.
   const begin = mode === "seek" ? Math.floor(Math.max(0, time) / window) * window : Math.floor(Math.max(0, time - window) / window) * window;
   let windows = cacheMap.get(source);
   if (!windows) {
      windows = new Map();
      cacheMap.set(source, windows);
   }
   let pending = windows.get(begin)?.value;
   if (!pending) {
      const cache = windows;
      const ownerSignal = sourceLifetimes.get(source);
      pending = (mode === "seek" ? readSeekWindow(source, begin, window, read, ownerSignal) : readPacketWindow(source, begin, read, ownerSignal))
         .then((points) => {
            const entry = cache.get(begin);
            if (entry && entry.value === pending) entry.points = points.length;
            // Bound retained timestamp objects as well as the number of windows.
            while ([...cache.values()].reduce((sum, value) => sum + value.points, 0) > 200_000) cache.delete(cache.keys().next().value!);
            return points;
         })
         .catch((error: unknown) => {
            if (cache.get(begin)?.value === pending) cache.delete(begin);
            throw error;
         });
      if (mode === "seek" && windows.size >= 48) windows.delete(windows.keys().next().value!);
      if (mode === "analysis" && windows.size >= 16) windows.delete(windows.keys().next().value!);
      windows.set(begin, { points: 0, value: pending });
   }
   const points = await waitForWork(pending, signal);
   signal?.throwIfAborted();
   return points;
}
/** FFprobe starts an interval at the preceding keyframe, which can be far before `begin`.
 * Keep reading until the whole cached seek region has a frame after it. */
async function readSeekWindow(source: ProbedSource, begin: number, window: number, initialRead: number, signal?: AbortSignal): Promise<PacketPoint[]> {
   const end = Math.min(source.duration, begin + window);
   let read = initialRead;
   for (;;) {
      signal?.throwIfAborted();
      const points = await readPacketWindow(source, begin, read, signal);
      const first = points[0]?.time ?? 0;
      const last = points.at(-1)?.time;
      if (last !== undefined && last > end + 0.0001) return points;
      // At this length the interval has reached EOF. A final frame may precede the
      // container duration, so no later packet is available to bracket the region.
      if (read >= source.duration - first + 2) return points;
      read = Math.min(source.duration + 2, Math.max(read * 2, end - first + 2));
   }
}
async function readPacketWindow(source: ProbedSource, begin: number, read: number, signal?: AbortSignal): Promise<PacketPoint[]> {
   const output = await runMedia(
      "ffprobe",
      [
         "-v",
         "error",
         "-fflags",
         "+genpts",
         "-select_streams",
         String(primaryVideo(source)!.index),
         "-read_intervals",
         begin > 0 ? `${begin + source.startOffset}%+${read}` : `%+${read}`,
         "-show_packets",
         "-show_entries",
         "packet=pts_time,dts_time,duration_time,flags",
         "-of",
         "json",
         source.path,
      ],
      { signal }
   );
   return packetSchema
      .parse(JSON.parse(output))
      .packets.filter((packet) => packet.pts_time !== undefined)
      .map((packet) => ({
         time: Number(packet.pts_time) - source.startOffset,
         key: packet.flags?.includes("K") ?? false,
         dts: Number(packet.dts_time) - source.startOffset,
         ...(Number(packet.duration_time) > 0 ? { duration: Number(packet.duration_time) } : {}),
      }))
      .filter((packet) => Number.isFinite(packet.time))
      .sort((a, b) => a.time - b.time);
}
