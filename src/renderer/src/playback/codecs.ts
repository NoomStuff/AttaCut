/** Audio codecs Chromium decodes natively; anything else needs a transcoded preview track. */
export const nativeAudioCodecs = new Set(["aac", "mp3", "opus", "vorbis", "flac"]);
