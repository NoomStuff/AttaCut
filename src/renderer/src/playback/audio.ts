import type { MediaSource } from "../../../shared/types";
interface AudioTrack {
   enabled: boolean;
}
export function selectNativeAudio(video: HTMLVideoElement, source: MediaSource, streamIndex: number | null): boolean {
   const audio = source.streams.filter((stream) => stream.type === "audio");
   if (!audio.length) return true;
   const tracks = (video as HTMLVideoElement & { audioTracks?: ArrayLike<AudioTrack> }).audioTracks;
   const selected = Math.max(
      0,
      audio.findIndex((stream) => stream.index === streamIndex)
   );
   if (!tracks || tracks.length !== audio.length) return false;
   Array.from(tracks).forEach((track, index) => {
      track.enabled = index === selected;
   });
   return true;
}
