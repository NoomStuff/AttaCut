import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { Clip, MediaSource } from "../../../shared/types";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { insideClip } from "../editor/model";
import { selectNativeAudio } from "../playback/audio";
import type { PlaybackController } from "../playback/controller";
import type { PlaybackSeeker } from "../playback/seeker";
import { nextKeptTime } from "../playback/ranges";
import { useExitValue } from "../lib/motion";

export function Player({
   source,
   url,
   videoRef,
   playback,
   clock,
   clips,
   keptOnly,
   volume,
   muted,
   onPlaying,
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
   playback: PlaybackController;
   clock: PlaybackClock;
   clips: Clip[];
   keptOnly: boolean;
   volume: number;
   muted: boolean;
   onPlaying: (playing: boolean) => void;
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
   const [readyUrl, setReadyUrl] = useState<string | null>(null);
   const [frameHeld, setFrameHeld] = useState(false);
   const [skipFrameFade, setSkipFrameFade] = useState(false);
   const snapshotRef = useRef<HTMLCanvasElement>(null);
   const previewLoading = !!url && !failed && (preparing || readyUrl !== url);
   const frameReady = !!url && readyUrl === url;
   const seekingFrame = useSyncExternalStore(seeker.subscribeWaiting, seeker.getWaiting);
   const [waitingForPlayback, setWaitingForPlayback] = useState(false);
   const blocked = !failed && (seekingFrame || waitForPlay || waitingForPlayback);
   const [showBlocked, setShowBlocked] = useState(false);
   // Leave the indicator mounted until its 200 ms fade has reached zero opacity.
   const blockedPresence = useExitValue(
      showBlocked && blocked
         ? seekingFrame
            ? "Loading frame..."
            : preparing
              ? "Preparing preview..."
              : previewLoading
                ? "Loading preview..."
                : "Waiting for playback..."
         : null,
      240
   );
   const latest = useRef({ clips, keptOnly });
   latest.current = { clips, keptOnly };
   useLayoutEffect(() => {
      playback.setHoldFrame(() => {
         const video = videoRef.current;
         const canvas = snapshotRef.current;
         if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
            setSkipFrameFade(false);
            return;
         }
         const scale = Math.min(1, 1920 / video.videoWidth, 1080 / video.videoHeight);
         canvas.width = Math.round(video.videoWidth * scale);
         canvas.height = Math.round(video.videoHeight * scale);
         try {
            const context = canvas.getContext("2d");
            if (!context) {
               setSkipFrameFade(false);
               return;
            }
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            setSkipFrameFade(true);
            setFrameHeld(true);
         } catch {
            setSkipFrameFade(false);
            setFrameHeld(false);
         }
      });
      return () => playback.setHoldFrame(null);
   }, [playback, videoRef]);
   useEffect(() => {
      if (!url) {
         setFrameHeld(false);
         setSkipFrameFade(false);
      }
   }, [url]);
   const revealFrame = () => {
      const video = videoRef.current;
      if (!video || video.currentSrc !== url || video.readyState < 2 || video.seeking || Math.abs(video.currentTime - clock.get()) > 0.15) return;
      setReadyUrl(url);
      setFrameHeld(false);
   };
   useEffect(() => {
      if (!blocked) {
         setShowBlocked(false);
         return;
      }
      const timer = window.setTimeout(() => setShowBlocked(true), 1000);
      return () => window.clearTimeout(timer);
   }, [blocked]);
   useEffect(() => seeker.attach(videoRef.current!), [seeker, videoRef]);
   useEffect(() => {
      const video = videoRef.current!;
      let frame = 0;
      const update = () => {
         if (!video.paused && video.readyState >= 2 && !video.seeking && !seeker.pending) {
            if (playback.previewEnd !== null && video.currentTime >= playback.previewEnd) {
               video.pause();
               seeker.seek(playback.previewEnd);
               playback.previewEnd = null;
            } else if (playback.previewEnd === null && latest.current.keptOnly && latest.current.clips.length) {
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
   }, [clock, playback, videoRef, seeker]);
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
      <div className={`player-stage${!frameReady && !frameHeld && !failed ? " pending" : ""}`}>
         <video
            ref={videoRef}
            className={frameReady ? `frame-ready${skipFrameFade ? " no-fade" : ""}` : ""}
            src={url}
            preload="auto"
            playsInline
            aria-label={source.name}
            onPlay={() => onPlaying(true)}
            onPlaying={() => {
               setWaitingForPlayback(false);
               revealFrame();
            }}
            onWaiting={() => {
               if (videoRef.current && !videoRef.current.paused) setWaitingForPlayback(true);
            }}
            onPause={() => {
               onPlaying(false);
               setWaitingForPlayback(false);
            }}
            onEnded={() => {
               onPlaying(false);
               setWaitingForPlayback(false);
            }}
            onLoadedData={() => {
               setWaitingForPlayback(false);
               revealFrame();
            }}
            onCanPlay={revealFrame}
            onSeeked={revealFrame}
            onError={() => {
               setWaitingForPlayback(false);
               setFrameHeld(false);
               setSkipFrameFade(false);
               if (url) onFailure();
            }}
            onLoadedMetadata={() => {
               if (videoRef.current && videoRef.current.videoWidth === 0) {
                  onFailure();
                  return;
               }
               if (videoRef.current) {
                  const target = Math.min(clock.get(), source.duration);
                  if (Math.abs(videoRef.current.currentTime - target) > 0.00001) videoRef.current.currentTime = target;
               }
               if (videoRef.current && audioIndices.length === 1) selectNativeAudio(videoRef.current, source, audioIndices);
               if (videoRef.current && playWhenReady) void videoRef.current.play().catch(onFailure);
            }}
            onDoubleClick={onFullscreen}
         />
         <canvas ref={snapshotRef} className={`preview-held-frame${frameHeld ? " visible" : ""}`} aria-hidden="true" />
         {blockedPresence.mounted && (
            <div className={`preview-loading delayed${blockedPresence.closing ? " closing" : ""}`} role="status" aria-hidden={blockedPresence.closing}>
               <span className="spinner" aria-hidden="true" />
               <span>{blockedPresence.value}</span>
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
