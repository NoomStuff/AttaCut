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
   const [playing, setPlaying] = useState(false);
   const [muted, setMuted] = useState(false);
   const [playback] = useState(() => new PlaybackController());
   const playbackState = useSyncExternalStore(playback.subscribe, playback.get);
   const { url } = playbackState;
   const preparing = playbackState.phase === "preparing";
   const playWhenReady = playbackState.intent === "requested";
   const waitForPlay = playbackState.showWait;
   const [audioIndices, setAudioIndices] = useState<number[]>([]);
   const [clock] = useState(() => new PlaybackClock());
   const [seeker] = useState(() => new PlaybackSeeker(clock));
   const [scrubber] = useState(() => new AudioScrubber());
   // Each source/selection owns a small PCM working set. Old identities are cleared immediately.
   useEffect(() => {
      scrubber.configure(
         source && preferences.audioScrub && audioIndices.length > 0 ? (time) => window.desktop.scrubAudio(source.id, audioIndices, time) : null
      );
      return () => {
         scrubber.reset();
         void window.desktop.cancelScrub();
      };
   }, [source, audioIndices, preferences.audioScrub, scrubber]);
   useEffect(() => () => scrubber.dispose(), [scrubber]);
   const preparePreview = async (target: MediaSource, tracks: number[], transcode = false, resume = false) => {
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
