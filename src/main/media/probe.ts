import { stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { MediaSource } from "../../shared/types.ts";
import { runMedia } from "./process.ts";
import { outputExtension } from "./formats.ts";
import { indexedKeyframes } from "./mp4-index.ts";

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
      (["smpte2084", "arib-std-b67"].includes(video.colorTransfer) ||
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
export async function sourceKeyframes(source: ProbedSource, signal?: AbortSignal): Promise<number[]> {
   const indexed = await indexedKeyframes(source, signal);
   if (indexed) return indexed;
   const data = await runMedia(
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
      { signal }
   );
   return [
      ...new Set(
         data
            .split(/\r?\n/)
            .filter((line) => line.includes("K"))
            .map((line) => Number(line.split(",")[0]) - source.startOffset)
            .filter((time) => Number.isFinite(time) && time >= 0 && time <= source.duration)
      ),
   ].sort((a, b) => a - b);
}
const packetWindows = new WeakMap<ProbedSource, Map<number, { points: number; value: Promise<PacketPoint[]> }>>();
export async function packetsAround(source: ProbedSource, time: number, signal?: AbortSignal): Promise<PacketPoint[]> {
   signal?.throwIfAborted();
   const begin = Math.floor(Math.max(0, time - 30) / 30) * 30;
   let windows = packetWindows.get(source);
   if (!windows) {
      windows = new Map();
      packetWindows.set(source, windows);
   }
   let pending = windows.get(begin)?.value;
   if (!pending) {
      const cache = windows;
      pending = readPacketWindow(source, begin, signal)
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
      if (windows.size >= 16) windows.delete(windows.keys().next().value!);
      windows.set(begin, { points: 0, value: pending });
   }
   const points = await pending;
   signal?.throwIfAborted();
   return points;
}
async function readPacketWindow(source: ProbedSource, begin: number, signal?: AbortSignal): Promise<PacketPoint[]> {
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
         begin > 0 ? `${begin + source.startOffset}%+95` : "%+95",
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
