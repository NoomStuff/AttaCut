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

const numberLike = z.union([z.string(), z.number()]).optional();
const probeSchema = z.object({
   format: z.object({ duration: numberLike, start_time: numberLike }),
   streams: z.array(
      z.object({
         index: z.number(),
         codec_type: z.string().optional(),
         codec_name: z.string().optional(),
         start_time: numberLike,
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
   startOffset: number;
}
export async function probeSource(path: string, signal?: AbortSignal): Promise<ProbedSource> {
   const fullPath = resolve(path);
   const info = await stat(fullPath);
   if (!info.isFile()) throw new Error("Choose a video file.");
   const result = probeSchema.parse(
      JSON.parse(await runMedia("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", fullPath], { signal }))
   );
   const duration = Number(result.format.duration);
   if (!Number.isFinite(duration) || duration <= 0) throw new Error("This file has no usable video duration.");
   const id = randomUUID();
   const streams = result.streams.map((stream) => ({
      index: stream.index,
      startTime: Number(stream.start_time ?? result.format.start_time) || 0,
      type: stream.codec_type ?? "unknown",
      codec: stream.codec_name ?? "unknown",
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
   if (!streams.some((stream) => stream.type === "video" && stream.width > 0)) throw new Error("This file does not contain a video track.");
   return {
      id,
      path: fullPath,
      name: basename(fullPath),
      directory: dirname(fullPath),
      extension: extname(fullPath),
      exportExtension: outputExtension({ extension: extname(fullPath) }),
      duration,
      size: info.size,
      modified: info.mtimeMs,
      streams,
      url: `media://source/${id}`,
      startOffset: Number(result.format.start_time) || 0,
      chapters: result.chapters.map((chapter) => ({
         start: Number(chapter.start_time),
         end: Number(chapter.end_time),
         title: chapter.tags?.["title"] ?? "",
      })),
   };
}
export async function assertSourceUnchanged(source: MediaSource): Promise<void> {
   const info = await stat(source.path);
   if (info.size !== source.size || info.mtimeMs !== source.modified) throw new Error("The original file changed. Reopen it before exporting.");
}
const packetSchema = z.object({
   packets: z.array(z.object({ pts_time: z.string().optional(), dts_time: z.string().optional(), flags: z.string().optional() })),
});
export interface PacketPoint {
   time: number;
   key: boolean;
   dts: number;
}
const sampleIndexes = new WeakMap<ProbedSource, Promise<SampleTimes | null>>();
/** Opening and keyframe snapping share the same MP4 table parse. */
function sampleTimes(source: ProbedSource, signal?: AbortSignal): Promise<SampleTimes | null> {
   let cached = sampleIndexes.get(source);
   if (!cached) {
      cached = indexedSampleTimes(source, signal).catch((error: unknown) => {
         if (sampleIndexes.get(source) === cached) sampleIndexes.delete(source);
         throw error;
      });
      sampleIndexes.set(source, cached);
   }
   return cached;
}
export async function sourceKeyframes(source: ProbedSource, signal?: AbortSignal): Promise<number[]> {
   const index = await sampleTimes(source, signal);
   if (index) return index.keyframes;
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
         String(source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)!.index),
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
export function sourceFrames(source: ProbedSource, signal?: AbortSignal): Promise<number[] | null> {
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
      pending = (mode === "seek" ? readSeekWindow(source, begin, window, read, signal) : readPacketWindow(source, begin, read, signal))
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
   const points = await pending;
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
         String(source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)!.index),
         "-read_intervals",
         begin > 0 ? `${begin + source.startOffset}%+${read}` : `%+${read}`,
         "-show_packets",
         "-show_entries",
         "packet=pts_time,dts_time,flags",
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
      }))
      .filter((packet) => Number.isFinite(packet.time))
      .sort((a, b) => a.time - b.time);
}
