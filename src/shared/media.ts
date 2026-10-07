/** Short audio reads keep cold scrubbing from competing with video for a long disk read. */
export const scrubChunkSeconds = 5;

export interface MediaStream {
   sampleRate?: number;
   channels?: number;
   channelLayout?: string;
   sampleAspectRatio?: string;
   startTime?: number;
   index: number;
   type: string;
   codec: string;
   title: string;
   language: string;
   width: number;
   height: number;
   pixelFormat: string;
   profile: string;
   timeBase: string;
   frameRate: number;
   colorTransfer: string;
   colorPrimaries: string;
   colorSpace: string;
   colorRange: string;
   chromaLocation: string;
   rotation: number;
   fieldOrder: string;
   masterDisplay: string;
   maxCll: string;
   dynamicHdr: boolean;
   attachedPicture: boolean;
   disposition: Record<string, number>;
}
export interface MediaSource {
   primaryVideoIndex?: number;
   /** Known primary-video extent, relative to the container origin. Omitted when the demuxer cannot report it. */
   videoInterval?: { start: number; end: number };
   id: string;
   path: string;
   name: string;
   directory: string;
   extension: string;
   exportExtension: string;
   /** Container extent, including delayed tracks and audio beyond the final picture. */
   duration: number;
   size: number;
   modified: number;
   streams: MediaStream[];
   url: string;
   chapters: { start: number; end: number; title: string; tags?: Record<string, string> }[];
}
export function primaryVideo(source: Pick<MediaSource, "streams" | "primaryVideoIndex">): MediaStream | undefined {
   return source.primaryVideoIndex === undefined
      ? source.streams.find((stream) => stream.type === "video" && !stream.attachedPicture)
      : source.streams.find((stream) => stream.index === source.primaryVideoIndex);
}
/** One bounded chunk of mono 16-bit PCM for scrub bursts. */
export interface ScrubAudio {
   start: number;
   sampleRate: number;
   pcm: ArrayBuffer;
}
/** Timeline waveform resolution and the decimated levels built from it. The finest level
    keeps one min/max pair per millisecond; each coarser level folds ten of the level below. */
export const waveformRate = 1000;
export const waveformLevels = [1000, 100, 10, 1];
export const waveformSampleRate = 16000;
/** Bound fine peaks to 24 MB. Zero means even one bucket per second exceeds that budget. */
export function waveformResolution(duration: number): number {
   return waveformLevels.find((rate) => Math.ceil(duration * rate) <= 8_000_000) ?? 0;
}
