import type { MediaSource } from "../../../shared/types";
interface AudioTrack {
   enabled: boolean;
}
export function selectNativeAudio(video: HTMLVideoElement, source: MediaSource, streamIndices: number[]): boolean {
   const audio = source.streams.filter((stream) => stream.type === "audio");
   if (!audio.length) return true;
   const tracks = (video as HTMLVideoElement & { audioTracks?: ArrayLike<AudioTrack> }).audioTracks;
   if (!tracks || tracks.length !== audio.length) return false;
   Array.from(tracks).forEach((track, index) => {
      track.enabled = streamIndices.includes(audio[index]!.index);
   });
   return true;
}
