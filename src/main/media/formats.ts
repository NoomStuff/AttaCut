import type { MediaStream, MediaSource } from "../../shared/types.ts";

export const videoExtensions = [
   "mp4",
   "mov",
   "mkv",
   "webm",
   "avi",
   "m4v",
   "ts",
   "mts",
   "m2ts",
   "mpg",
   "mpeg",
   "m2v",
   "vob",
   "flv",
   "wmv",
   "asf",
   "ogv",
   "mxf",
   // Camcorder, phone, TV-recorder and raw-stream containers; opening stays validated by ffprobe content.
   "3gp",
   "3g2",
   "f4v",
   "m1v",
   "mpe",
   "m2p",
   "m2t",
   "mod",
   "tod",
   "vro",
   "divx",
   "dv",
   "ogm",
   "wtv",
   "dvr-ms",
   "mjpg",
   "h264",
   "264",
   "h265",
   "265",
   "hevc",
];
const intraCodecs = new Set([
   "prores",
   "dnxhd",
   "mjpeg",
   "mjpegb",
   "dvvideo",
   "rawvideo",
   "v210",
   "cfhd",
   "huffyuv",
   "ffvhuff",
   "utvideo",
   "ffv1",
   "magicyuv",
   "lagarith",
   "fraps",
   "sheervideo",
   "png",
   "qtrle",
   "rpza",
   "smc",
   "8bps",
   "r10k",
   "r210",
   "v410",
   "v308",
   "v408",
   "avrp",
]);
export function isIntraCodec(codec: string): boolean {
   return intraCodecs.has(codec);
}
/** Encoders that can reproduce an interlaced field structure for boundary sections. */
export function supportsInterlacedEncoding(codec: string): boolean {
   return ["h264", "hevc", "mpeg2video"].includes(codec);
}
/** Matroska-family muxers silently drop data streams, so telemetry is kept only in MP4-family outputs. */
export function containerKeepsData(extension: string): boolean {
   return isMp4Container(extension);
}
export function segmentExtension(codec: string): string {
   return ["h264", "hevc", "mpeg2video", "mpeg1video", "mpeg4"].includes(codec) ? ".ts" : ".mkv";
}
export function outputExtension(source: Pick<MediaSource, "extension">): string {
   const extension = source.extension.toLowerCase();
   if ([".mp4", ".m4v", ".mov", ".mkv", ".webm"].includes(extension)) return extension;
   return ".mkv";
}
export function isHdrTransfer(transfer: string): boolean {
   return ["smpte2084", "arib-std-b67"].includes(transfer);
}
export function isMp4Container(extension: string): boolean {
   return [".mp4", ".mov", ".m4v"].includes(extension.toLowerCase());
}
/** Container options for MP-family outputs; hvc1 tags HEVC the way Apple's decoders require. */
export function containerFlags(video: MediaStream): string[] {
   return ["-movflags", "+faststart", ...(video.codec === "hevc" ? ["-tag:v", "hvc1"] : [])];
}
/**
 * Convert HDR input to bt709 SDR. `inputMatrix` carries the source primaries/transfer/matrix
 * when stream headers leave them unspecified and they must be pinned by hand.
 */
export function tonemapToBt709(outputFormat: string, inputMatrix?: string): string {
   const source = inputMatrix ? `${inputMatrix}:t=linear:npl=100` : "zscale=t=linear:npl=100";
   return `${source},format=gbrpf32le,zscale=p=bt709,tonemap=mobius:desat=0,zscale=t=bt709:m=bt709:r=tv,format=${outputFormat}`;
}
export function colorArguments(video: MediaStream): string[] {
   const args: string[] = [];
   for (const [flag, value] of [
      ["-color_primaries", video.colorPrimaries],
      ["-color_trc", video.colorTransfer],
      ["-colorspace", video.colorSpace],
      ["-color_range", video.colorRange],
      ["-chroma_sample_location", video.chromaLocation],
   ]) {
      if (value && value !== "unknown" && value !== "unspecified") args.push(flag!, value);
   }
   return args;
}
/** True when the stream's field order marks it as interlaced (top or bottom field first). */
function isInterlaced(video: MediaStream): boolean {
   return Boolean(video.fieldOrder) && !["unknown", "progressive"].includes(video.fieldOrder);
}
function topFieldFirst(video: MediaStream): boolean {
   return !["bb", "tb"].includes(video.fieldOrder);
}
export function encoderArguments(video: MediaStream): string[] | null {
   const common = [
      "-pix_fmt",
      video.pixelFormat,
      "-fps_mode",
      "passthrough",
      ...(["h264", "hevc", "av1", "vp9", "vp8"].includes(video.codec) ? ["-enc_time_base", "1:90000"] : []),
      ...colorArguments(video),
   ];
   switch (video.codec) {
      case "h264":
         return [
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "17",
            "-x264-params",
            ["open-gop=0", "repeat-headers=1", ...(isInterlaced(video) ? ["interlaced=1", topFieldFirst(video) ? "tff=1" : "bff=1"] : [])].join(":"),
            ...common,
         ];
      case "hevc":
         return [
            "-c:v",
            "libx265",
            "-preset",
            "fast",
            "-crf",
            "17",
            "-x265-params",
            [
               "open-gop=0",
               "repeat-headers=1",
               "log-level=error",
               "pools=4",
               ...(isInterlaced(video) ? ["interlaced=1"] : []),
               ...(video.masterDisplay ? [`master-display=${video.masterDisplay}`] : []),
               ...(video.maxCll ? [`max-cll=${video.maxCll}`] : []),
            ].join(":"),
            ...common,
         ];
      case "vp9":
         return ["-c:v", "libvpx-vp9", "-deadline", "good", "-cpu-used", "4", "-crf", "18", "-b:v", "0", "-auto-alt-ref", "0", ...common];
      case "vp8":
         return ["-c:v", "libvpx", "-deadline", "good", "-cpu-used", "4", "-crf", "6", "-b:v", "8M", "-auto-alt-ref", "0", ...common];
      case "av1":
         return ["-c:v", "libaom-av1", "-cpu-used", "8", "-crf", "18", "-b:v", "0", "-row-mt", "1", ...common];
      case "mpeg4":
         return ["-c:v", "mpeg4", "-q:v", "2", "-bf", "0", ...common, "-enc_time_base", `1:${video.frameRate}`];
      case "mpeg2video":
         return [
            "-c:v",
            "mpeg2video",
            "-q:v",
            "2",
            "-bf",
            "0",
            ...(isInterlaced(video) ? ["-flags", "+ilme+ildct", "-field_order", topFieldFirst(video) ? "tt" : "bb"] : []),
            ...common,
         ];
      case "mpeg1video":
      case "wmv2":
      case "wmv1":
         return ["-c:v", video.codec, "-q:v", "2", "-bf", "0", ...common];
      case "msmpeg4v2":
      case "msmpeg4v3":
         return ["-c:v", video.codec === "msmpeg4v3" ? "msmpeg4" : "msmpeg4v2", "-q:v", "2", "-bf", "0", ...common];
      case "h263":
         return ["-c:v", "h263", "-q:v", "2", ...common];
      case "ffv1":
         return ["-c:v", "ffv1", "-level", "3", ...common];
      default:
         return null;
   }
}
