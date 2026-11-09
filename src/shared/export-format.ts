import type { MediaSource, MediaStream } from "./media";
import type { Clip } from "./editing";

/** Containers a user can pick for an export. "auto" keeps the source container where it is reliable. */
export const exportContainers = [".mp4", ".mov", ".mkv", ".webm"] as const;
export type ExportContainer = (typeof exportContainers)[number];
export type ContainerChoice = "auto" | ExportContainer;
export const containerNames: Record<ExportContainer, string> = { ".mp4": "MP4", ".mov": "MOV", ".mkv": "MKV", ".webm": "WebM" };

/**
 * Codecs each container stores in a form common players read. Matroska stores everything
 * FFmpeg can copy. The lists stay conservative: a muxer that accepts a codec is not enough
 * when the result does not play, for example PCM or Vorbis inside MP4.
 */
const videoCodecs: Record<Exclude<ExportContainer, ".mkv">, ReadonlySet<string>> = {
   ".mp4": new Set(["h264", "hevc", "av1", "vp9", "mpeg4", "mpeg2video", "mpeg1video", "mjpeg"]),
   ".mov": new Set(["h264", "hevc", "prores", "dnxhd", "mjpeg", "dvvideo", "h263", "mpeg4", "mpeg2video", "mpeg1video", "png", "qtrle"]),
   ".webm": new Set(["vp8", "vp9", "av1"]),
};
const audioCodecs: Record<Exclude<ExportContainer, ".mkv">, (codec: string) => boolean> = {
   ".mp4": (codec) => ["aac", "mp3", "mp2", "ac3", "eac3", "alac", "opus", "flac"].includes(codec),
   ".mov": (codec) => ["aac", "mp3", "mp2", "ac3", "eac3", "alac"].includes(codec) || codec.startsWith("pcm_"),
   ".webm": (codec) => ["opus", "vorbis"].includes(codec),
};
const textSubtitles = new Set(["subrip", "ass", "ssa", "mov_text", "webvtt", "text"]);

/** Normalize an output extension to the container family whose rules apply to it. */
export function containerFamily(extension: string): ExportContainer {
   const value = extension.toLowerCase();
   if (value === ".m4v" || value === ".mp4") return ".mp4";
   if (value === ".mov" || value === ".webm") return value;
   return ".mkv";
}

/** Text subtitles are rewritten into the format each container stores. */
export function subtitleCodecFor(extension: string, codec: string): string {
   const family = containerFamily(extension);
   if (family === ".mp4" || family === ".mov") return "mov_text";
   if (family === ".webm") return "webvtt";
   return codec === "mov_text" ? "subrip" : codec;
}

/**
 * Whether `extension` can hold this stream. Telemetry is handled separately: it is left out
 * of containers that cannot store it, with a note. Returns the reason when it cannot.
 */
export function containerRejects(extension: string, stream: MediaStream): string | null {
   const family = containerFamily(extension);
   const name = containerNames[family];
   if (family === ".mkv" || stream.type === "data") return null;
   if (stream.type === "video" && stream.attachedPicture)
      return family === ".webm" ? `${name} cannot store cover pictures. Turn off the cover in Advanced or pick MKV.` : null;
   if (stream.type === "video") return videoCodecs[family].has(stream.codec) ? null : `${name} cannot store ${stream.codec.toUpperCase()} video.`;
   if (stream.type === "audio")
      return audioCodecs[family](stream.codec) ? null : `${name} cannot store ${audioName(stream.codec)} audio. Turn off that audio track or pick MKV.`;
   if (stream.type === "subtitle")
      return textSubtitles.has(stream.codec) ? null : `${name} cannot store picture subtitles. Turn off the subtitle track in Advanced or pick MKV.`;
   if (stream.type === "attachment") return `${name} cannot store attachments such as fonts. Turn them off in Advanced or pick MKV.`;
   return null;
}
function audioName(codec: string): string {
   return codec.startsWith("pcm_") ? "PCM" : codec.toUpperCase();
}

/** Containers that can hold the primary video, in display order. */
export function containerChoices(source: Pick<MediaSource, "streams" | "primaryVideoIndex">): ExportContainer[] {
   const video =
      source.primaryVideoIndex === undefined
         ? source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)
         : source.streams.find((stream) => stream.index === source.primaryVideoIndex);
   return exportContainers.filter((container) => !video || !containerRejects(container, video));
}

/**
 * A separate export spanning the whole source with nothing changed keeps the source container,
 * unless another container was picked. Everything else exports to the chosen or automatic container.
 */
export function exportExtensionFor(
   source: Pick<MediaSource, "extension" | "exportExtension" | "duration">,
   clip: Pick<Clip, "start" | "end">,
   options: { separate: boolean; unchanged: boolean; container?: ContainerChoice }
): string {
   if (options.container && options.container !== "auto") return options.container;
   const fullRange = clip.start === 0 && Math.abs(clip.end - source.duration) < 0.0001;
   return options.unchanged && options.separate && fullRange ? source.extension : source.exportExtension;
}
