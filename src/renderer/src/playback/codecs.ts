import { primaryVideo } from "../../../shared/media";
import type { MediaSource } from "../../../shared/media";

/** Audio codecs Chromium decodes natively; anything else needs a transcoded preview track. */
export const nativeAudioCodecs = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);

/** Containers Chromium's media element opens. Anything else goes straight to a converted
    preview: an attempt on WMV, for example, can stall without ever reporting an error. */
const nativeContainers = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);
/** Video codecs Chromium can decode on at least one platform. HEVC still falls back by error. */
const nativeVideoCodecs = new Set(["h264", "hevc", "vp8", "vp9", "av1"]);
export function needsConvertedVideo(source: Pick<MediaSource, "extension" | "streams" | "primaryVideoIndex">): boolean {
   const video = primaryVideo(source);
   return !nativeContainers.has(source.extension.toLowerCase()) || !video || !nativeVideoCodecs.has(video.codec);
}
