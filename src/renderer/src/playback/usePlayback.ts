import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { MediaSource, Preferences } from "../../../shared/types";
import { selectNativeAudio } from "./audio";
import { rememberAudioSelection } from "./audioSelection";
import { PlaybackSeeker } from "./seeker";
import { AudioScrubber } from "./scrubber";
import { PlaybackController } from "./controller";
import { PlaybackClock } from "./clock";
import { errorText, isCancellation } from "../lib/errors";
import { afterIdle } from "../lib/prefetch";

export function usePlayback({
   source,
   preferences,
   setPreferences,
   setError,
}: {
   source: MediaSource | null;
   preferences: Preferences;
   setPreferences: Dispatch<SetStateAction<Preferences>>;
   setError: (message: string | null) => void;
}) {
   const videoRef = useRef<HTMLVideoElement>(null);
   const [muted, setMuted] = useState(false);
   const [playback] = useState(() => new PlaybackController());
   const playbackState = useSyncExternalStore(playback.subscribe, playback.get);
   const playing = playbackState.intent === "playing";
   const setPlaying = (value: boolean) => {
      if (value) playback.playing();
      else if (playback.get().intent === "playing") playback.pause();
   };
   const { url } = playbackState;
   const preparing = playbackState.phase === "preparing";
   const playWhenReady = playbackState.intent === "requested";
   const waitForPlay = playbackState.showWait;
   const [audioIndices, setAudioIndices] = useState<number[]>([]);
   const audibleSelection = useRef<{ sourceId: string; tracks: number[] } | null>(null);
   useEffect(() => {
      if (source && audioIndices.length) audibleSelection.current = { sourceId: source.id, tracks: audioIndices };
   }, [source, audioIndices]);
   const [clock] = useState(() => new PlaybackClock());
   const [seeker] = useState(() => new PlaybackSeeker(clock));
   const [scrubber] = useState(() => new AudioScrubber());
   // Each source/selection owns a small PCM working set. Old identities are cleared immediately.
   useEffect(() => {
      scrubber.configure(
         source && preferences.audioScrub && audioIndices.length > 0 ? (time) => window.desktop.scrubAudio(source.id, audioIndices, time) : null
      );
      const video = videoRef.current;
      let cancelIdle = () => {};
      const warm = () => {
         cancelIdle();
         if (!video || video.readyState < 2 || !video.paused || video.seeking || !preferences.audioScrub) return;
         cancelIdle = afterIdle(() => {
            if (video.paused && !video.seeking) scrubber.prefetch(clock.get());
         });
      };
      const play = () => {
         cancelIdle();
         scrubber.suspend();
         void window.desktop.cancelScrub();
      };
      video?.addEventListener("loadeddata", warm);
      video?.addEventListener("pause", warm);
      video?.addEventListener("play", play);
      warm();
      return () => {
         cancelIdle();
         video?.removeEventListener("loadeddata", warm);
         video?.removeEventListener("pause", warm);
         video?.removeEventListener("play", play);
         scrubber.reset();
         void window.desktop.cancelScrub();
      };
   }, [source, audioIndices, preferences.audioScrub, scrubber, clock]);
   useEffect(() => {
      if (muted || preferences.volume <= 0) scrubber.stop();
   }, [muted, preferences.volume, scrubber]);
   useEffect(() => {
      const stop = () => scrubber.stop();
      window.addEventListener("blur", stop);
      return () => {
         window.removeEventListener("blur", stop);
         scrubber.dispose();
      };
   }, [scrubber]);
   const preparePreview = async (target: MediaSource, tracks: number[], transcode = false, resume = false) => {
      if (tracks.length) audibleSelection.current = { sourceId: target.id, tracks };
      const video = videoRef.current;
      if (resume || (video && !video.paused)) playback.request(false);
      video?.pause();
      setError(null);
      try {
         await playback.prepare(
            target.id,
            transcode,
            () => window.desktop.preparePreview(target.id, tracks, transcode),
            () => playback.holdPreviewFrame()
         );
      } catch (value) {
         const message = errorText(value);
         if (!isCancellation(message)) setError(message);
      }
   };
   const changeAudio = (indices: number[]) => {
      scrubber.reset();
      setAudioIndices(indices);
      if (source) {
         const tracks = source.streams.filter((stream) => stream.type === "audio");
         setPreferences((current) => ({ ...current, playbackAudio: rememberAudioSelection(tracks, indices) }));
         const video = videoRef.current;
         if (video) video.muted = muted || !indices.length;
         // Silence needs no recording-sized remux. Keep the existing preview ready
         // so selecting the same tracks again only restores its audio.
         if (!indices.length) return;
         const previous = audibleSelection.current;
         if (
            !audioIndices.length &&
            previous?.sourceId === source.id &&
            playback.get().phase !== "failed" &&
            previous.tracks.length === indices.length &&
            previous.tracks.every((track, index) => track === indices[index])
         )
            return;
         audibleSelection.current = { sourceId: source.id, tracks: indices };
         if (video && (indices.length !== 1 || !selectNativeAudio(video, source, indices)))
            void preparePreview(source, indices, playback.get().transcode, !video.paused);
      }
   };
   return {
      playing,
      setPlaying,
      muted,
      setMuted,
      playback,
      playbackState,
      url,
      preparing,
      playWhenReady,
      waitForPlay,
      audioIndices,
      setAudioIndices,
      videoRef,
      clock,
      seeker,
      scrubber,
      preparePreview,
      changeAudio,
   };
}
