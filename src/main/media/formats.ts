import type { MediaStream, MediaSource } from "../../shared/types.ts";

export const videoExtensions = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "ts", "mts", "m2ts", "mpg", "mpeg", "m2v", "vob", "flv", "wmv", "asf", "ogv", "mxf"];
const intraCodecs = new Set(["prores", "dnxhd", "mjpeg", "dvvideo", "rawvideo", "v210", "cfhd", "huffyuv", "ffvhuff", "utvideo"]);
export function isIntraCodec(codec: string): boolean {
   return intraCodecs.has(codec);
}
export function segmentExtension(codec: string): string {
   return ["h264", "hevc", "mpeg2video", "mpeg1video", "mpeg4"].includes(codec) ? ".ts" : ".mkv";
}
export function outputExtension(source: Pick<MediaSource, "extension">): string {
   const extension = source.extension.toLowerCase();
   if ([".mp4", ".m4v", ".mov", ".mkv", ".webm"].includes(extension)) return extension;
   return ".mkv";
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
export function encoderArguments(video: MediaStream): string[] | null {
   const common = [
      "-pix_fmt",
      `+${video.pixelFormat}`,
      "-fps_mode",
      "passthrough",
      ...(["h264", "hevc", "av1", "vp9", "vp8"].includes(video.codec) ? ["-enc_time_base", "1:90000"] : []),
      ...colorArguments(video),
   ];
   switch (video.codec) {
      case "h264":
         return ["-c:v", "libx264", "-preset", "fast", "-crf", "17", "-x264-params", "open-gop=0:repeat-headers=1", ...common];
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
      case "mpeg1video":
      case "wmv2":
      case "wmv1":
         return ["-c:v", video.codec, "-q:v", "2", "-bf", "0", ...common];
      case "ffv1":
         return ["-c:v", "ffv1", "-level", "3", ...common];
      default:
         return null;
   }
}
