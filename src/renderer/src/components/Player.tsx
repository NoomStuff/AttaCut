import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Clip, MediaSource } from "../../../shared/types";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { insideClip } from "../editor/model";
import { selectNativeAudio } from "../playback/audio";
import type { PlaybackSeeker } from "../playback/seeker";
import { nextKeptTime } from "../playback/ranges";

export function Player({
   source,
   url,
   videoRef,
   clock,
   clips,
   keptOnly,
   previewEnd,
   volume,
   muted,
   onPlaying,
   onPreviewEnd,
   onFailure,
   playWhenReady,
   waitForPlay,
   preparing,
   failed,
   audioIndices,
   seeker,
   onFullscreen,
   trimming,
}: {
   source: MediaSource;
   url: string;
   videoRef: RefObject<HTMLVideoElement | null>;
   clock: PlaybackClock;
   clips: Clip[];
   keptOnly: boolean;
   previewEnd: RefObject<number | null>;
   volume: number;
   muted: boolean;
   onPlaying: (playing: boolean) => void;
   onPreviewEnd: () => void;
   onFailure: () => void;
   playWhenReady: boolean;
   waitForPlay: boolean;
   preparing: boolean;
   failed: boolean;
   audioIndices: number[];
   seeker: PlaybackSeeker;
   onFullscreen: () => void;
   trimming: boolean;
}) {
   const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
   const previewLoading = !failed && (preparing || loadedUrl !== url);
   const [showWait, setShowWait] = useState(false);
   const latest = useRef({ clips, keptOnly, onPreviewEnd });
   latest.current = { clips, keptOnly, onPreviewEnd };
   useEffect(() => {
      setShowWait(false);
      if (!waitForPlay) return;
      const timer = window.setTimeout(() => setShowWait(true), 500);
      return () => window.clearTimeout(timer);
   }, [waitForPlay]);
   useEffect(() => seeker.attach(videoRef.current!), [seeker, videoRef]);
   useEffect(() => {
      const video = videoRef.current!;
      let frame = 0;
      const update = () => {
         if (!video.paused && video.readyState >= 2 && !video.seeking && !seeker.pending) {
            if (previewEnd.current !== null && video.currentTime >= previewEnd.current) {
               video.pause();
               seeker.seek(previewEnd.current);
               latest.current.onPreviewEnd();
            } else if (previewEnd.current === null && latest.current.keptOnly && latest.current.clips.length) {
               const next = nextKeptTime(latest.current.clips, video.currentTime);
               if (next === null) seeker.seek(latest.current.clips.at(-1)!.end);
               else if (next !== video.currentTime) seeker.seek(next, true);
            }
         }
         if (!video.paused && video.readyState > 0 && !video.seeking && !seeker.pending) clock.set(video.currentTime);
         if (!video.paused) frame = requestAnimationFrame(update);
      };
      const start = () => {
         cancelAnimationFrame(frame);
         frame = requestAnimationFrame(update);
      };
      const stop = () => cancelAnimationFrame(frame);
      video.addEventListener("play", start);
      video.addEventListener("pause", stop);
      video.addEventListener("ended", stop);
      if (!video.paused) start();
      return () => {
         stop();
         video.removeEventListener("play", start);
         video.removeEventListener("pause", stop);
         video.removeEventListener("ended", stop);
      };
   }, [clock, previewEnd, videoRef, seeker]);
   useEffect(() => {
      if (videoRef.current) {
         videoRef.current.volume = volume;
         videoRef.current.muted = muted;
      }
   }, [volume, muted, videoRef]);
   useEffect(() => {
      if (videoRef.current && audioIndices.length === 1) selectNativeAudio(videoRef.current, source, audioIndices);
   }, [source, audioIndices, videoRef]);
   return (
      <div className="player-stage">
         <video
            ref={videoRef}
            src={url}
            preload="auto"
            playsInline
            aria-label={source.name}
            onPlay={() => onPlaying(true)}
            onPause={() => onPlaying(false)}
            onEnded={() => onPlaying(false)}
            onLoadedData={() => setLoadedUrl(url)}
            onError={onFailure}
            onLoadedMetadata={() => {
               if (videoRef.current && videoRef.current.videoWidth === 0) {
                  onFailure();
                  return;
               }
               if (videoRef.current) videoRef.current.currentTime = Math.min(clock.get(), source.duration);
               if (videoRef.current && audioIndices.length === 1) selectNativeAudio(videoRef.current, source, audioIndices);
               if (videoRef.current && playWhenReady) void videoRef.current.play().catch(onFailure);
            }}
            onDoubleClick={onFullscreen}
         />
         {previewLoading && (
            <div className="preview-loading skeleton" role="status">
               <span>{preparing ? "Preparing preview..." : "Loading preview..."}</span>
            </div>
         )}
         {showWait && !previewLoading && (
            <div className="player-play-wait" role="status" aria-label="Loading playback">
               <span className="spinner" />
            </div>
         )}
         <ExcludedHint clock={clock} clips={clips} duration={source.duration} trimming={trimming} />
      </div>
   );
}
function ExcludedHint({ clock, clips, duration, trimming }: { clock: PlaybackClock; clips: Clip[]; duration: number; trimming: boolean }) {
   const time = useClock(clock);
   const included = insideClip(clips, time, duration);
   // While a handle drag pins the playhead onto a boundary, the draft is not yet the document.
   return <div className={`player-excluded ${included || trimming ? "hidden" : ""}`}>Not included in export</div>;
}
