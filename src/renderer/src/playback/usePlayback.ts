import { audioStreams } from "../../../shared/media";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { MediaSource, Preferences } from "../../../shared/types";
import type { PlaybackSpeed } from "./speed";
import { selectNativeAudio } from "./audio";
import { rememberAudioSelection } from "./audioSelection";
import { PlaybackSeeker } from "./seeker";
import { AudioScrubber } from "./scrubber";
import { PlaybackController } from "./controller";
import { PlaybackClock } from "./clock";
import { errorText, isCancellation } from "../lib/errors";
import { afterIdle } from "../lib/prefetch";
import { PreviewStream, streamingSupported } from "./stream";

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
   const [speed, setSpeed] = useState<PlaybackSpeed>(1);
   const [muted, setMuted] = useState(false);
   const [playback] = useState(() => new PlaybackController());
   const playbackState = useSyncExternalStore(playback.subscribe, playback.get);
   const playing = playbackState.intent === "playing";
   const setPlaying = (value: boolean) => {
      if (value) {
         const state = playback.get();
         if (state.phase !== "preparing" && videoRef.current?.currentSrc === state.url) playback.playing();
      } else if (playback.get().intent === "playing") playback.pause();
   };
   const { url } = playbackState;
   const preparing = playbackState.phase === "preparing";
   const playWhenReady = playbackState.intent === "requested";
   const [audioIndices, setAudioIndices] = useState<number[]>([]);
   const audibleSelection = useRef<{ sourceId: string; tracks: number[] } | null>(null);
   useEffect(() => {
      if (source && audioIndices.length) audibleSelection.current = { sourceId: source.id, tracks: audioIndices };
   }, [source, audioIndices]);
   const [clock] = useState(() => new PlaybackClock());
   const [seeker] = useState(() => new PlaybackSeeker(clock, () => playback.pause()));
   const pause = () => {
      playback.pause();
      videoRef.current?.pause();
   };
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
   // A converted preview streams by default: only the watched region is decoded and the
   // first frame shows without waiting for a whole-file conversion. A source whose stream
   // fails falls back to a prepared preview file.
   const stream = useRef<PreviewStream | null>(null);
   const streamFailures = useRef(new Set<string>());
   // Retire a stream once the player moves away from it. A stream created during this
   // render has not been shown yet and must survive the url it is replacing.
   const shownUrl = useRef("");
   useEffect(() => {
      const previous = shownUrl.current;
      shownUrl.current = url;
      const current = stream.current;
      if (current && previous === current.url && url !== current.url) {
         current.dispose();
         stream.current = null;
      }
   }, [url]);
   useEffect(
      () => () => {
         stream.current?.dispose();
         stream.current = null;
      },
      []
   );
   /** Stop streaming this source and switch to a prepared file. False when it was not streaming. */
   const abandonStream = (target: MediaSource, tracks: number[]): boolean => {
      if (!stream.current || playback.get().url !== stream.current.url) return false;
      streamFailures.current.add(target.id);
      const video = videoRef.current;
      void preparePreview(target, tracks, true, playback.get().intent !== "paused" || (video ? !video.paused : false));
      return true;
   };
   const preparePreview = async (target: MediaSource, tracks: number[], transcode = false, resume = false) => {
      if (tracks.length) audibleSelection.current = { sourceId: target.id, tracks };
      const video = videoRef.current;
      if (resume || (video && !video.paused)) playback.request(false);
      video?.pause();
      setError(null);
      const streamed = transcode && !streamFailures.current.has(target.id) && streamingSupported();
      const load = streamed
         ? async () => {
              void window.desktop.cancelPreview();
              // A stream replaced before it was shown never gets a url change to retire it.
              stream.current?.dispose();
              const next = new PreviewStream({
                 sourceId: target.id,
                 duration: target.duration,
                 tracks,
                 video: () => videoRef.current,
                 start: clock.get(),
                 onError: () => {
                    if (stream.current === next) abandonStream(target, tracks);
                 },
              });
              stream.current = next;
              return next.url;
           }
         : () => window.desktop.preparePreview(target.id, tracks, transcode);
      try {
         await playback.prepare(target.id, transcode, load, () => playback.holdPreviewFrame());
      } catch (value) {
         const message = errorText(value);
         if (!isCancellation(message)) setError(message);
      }
   };
   const changeAudio = (indices: number[]) => {
      scrubber.reset();
      setAudioIndices(indices);
      if (source) {
         const tracks = audioStreams(source);
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
      pause,
      setPlaying,
      speed,
      setSpeed,
      muted,
      setMuted,
      playback,
      playbackState,
      url,
      preparing,
      playWhenReady,
      audioIndices,
      setAudioIndices,
      videoRef,
      clock,
      getPreviewTime: () => clock.previewTime(videoRef.current, seeker.pending),
      seeker,
      scrubber,
      preparePreview,
      abandonStream,
      changeAudio,
   };
}
