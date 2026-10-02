import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, RefObject } from "react";
import type { Clip, MediaSource } from "../../../shared/types";
import type { PlaybackClock } from "../playback/clock";
import { useClock, useFrameTime } from "../playback/clock";
import { insideClip } from "../editor/model";
import { clipColor } from "../editor/colors";
import { selectNativeAudio } from "../playback/audio";
import type { PlaybackController } from "../playback/controller";
import type { PlaybackSeeker } from "../playback/seeker";
import { nextKeptTime } from "../playback/ranges";
import { useExitValue } from "../lib/motion";
import { presentationTime } from "../playback/presentation";
import { clamp, formatTime } from "../../../shared/time";
import { IconButton } from "./Controls";
import { AudioPicker } from "./AudioPicker";
import { VolumeSlider } from "./VolumeSlider";
import { faPlay, faPause, faBackwardStep, faForwardStep, faVolumeHigh, faVolumeXmark, faCompress } from "@fortawesome/free-solid-svg-icons";

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
   onAudioFallback,
   playWhenReady,
   waitForPlay,
   preparing,
   failed,
   audioIndices,
   onAudio,
   onVolume,
   onSeek,
   seeker,
   playing,
   fullscreen,
   onSetFullscreen,
   onTogglePlay,
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
   onAudioFallback: () => void;
   playWhenReady: boolean;
   waitForPlay: boolean;
   preparing: boolean;
   failed: boolean;
   audioIndices: number[];
   onAudio: (indices: number[]) => void;
   onVolume: (value: number, restore: number) => void;
   onSeek: (time: number) => void;
   seeker: PlaybackSeeker;
   playing: boolean;
   fullscreen: boolean;
   onSetFullscreen: (value: boolean) => void;
   onTogglePlay: () => void;
   trimming: boolean;
}) {
   const [readyUrl, setReadyUrl] = useState<string | null>(null);
   const [frameHeld, setFrameHeld] = useState(false);
   const [skipFrameFade, setSkipFrameFade] = useState(false);
   const snapshotRef = useRef<HTMLCanvasElement>(null);
   const previewLoading = !!url && !failed && (preparing || readyUrl !== url);
   const frameReady = !!url && readyUrl === url;
   const seekingFrame = useSyncExternalStore(seeker.subscribeWaiting, seeker.getWaiting);
   const frameProgress = useSyncExternalStore(seeker.subscribeProgress, seeker.getProgress);
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
   // Fullscreen stays mounted through its exit animation; controls inside idle away only
   // while the video plays, and pausing brings them back for good.
   const fullscreenPresence = useExitValue(fullscreen ? "on" : null, 190);
   const inFullscreen = fullscreenPresence.value !== null;
   const [controlsShown, setControlsShown] = useState(true);
   const idleTimer = useRef(0);
   const wake = useCallback(() => {
      setControlsShown(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setControlsShown(false), 2600);
   }, []);
   useEffect(() => () => window.clearTimeout(idleTimer.current), []);
   useEffect(() => {
      if (!inFullscreen || !playing) {
         window.clearTimeout(idleTimer.current);
         setControlsShown(true);
         return;
      }
      wake();
      return () => window.clearTimeout(idleTimer.current);
   }, [inFullscreen, playing, wake]);
   useEffect(() => {
      if (!inFullscreen) return;
      const escape = (event: KeyboardEvent) => {
         if (event.key === "Escape") onSetFullscreen(false);
      };
      window.addEventListener("keydown", escape);
      return () => window.removeEventListener("keydown", escape);
   }, [inFullscreen, onSetFullscreen]);
   // Chromium's Windows video presentation intermittently misplaces the presented frame of
   // a paused video when the scene around it changes: the controls fading in or out shift
   // the picture aside or collapse it to a sliver, and window occlusion does the same. The
   // page cannot see or prevent the misplacement, but presenting the frame again heals it —
   // the same reason pressing play fixes it. A 0.5 ms hop re-presents the current frame
   // without leaving it, so nothing visible changes.
   const repaintPausedFrame = useCallback(() => {
      const video = videoRef.current;
      if (!inFullscreen || playing || !frameReady || !video || video.seeking || seeker.pending) return;
      const hop = 0.0005;
      const target = video.currentTime > hop ? video.currentTime - hop : video.currentTime + hop;
      video.currentTime = Math.min(target, video.duration || target);
   }, [inFullscreen, playing, frameReady, videoRef, seeker]);
   useEffect(() => {
      if (!inFullscreen) return;
      repaintPausedFrame();
      // The misplacement can land a beat after the commit that provokes it (or while the
      // fullscreen animation is still running), so sweep a second time.
      const late = window.setTimeout(repaintPausedFrame, 180);
      return () => window.clearTimeout(late);
   }, [repaintPausedFrame, controlsShown, inFullscreen]);
   useEffect(() => {
      if (!inFullscreen) return;
      const reappear = () => {
         if (document.visibilityState === "visible") repaintPausedFrame();
      };
      document.addEventListener("visibilitychange", reappear);
      return () => document.removeEventListener("visibilitychange", reappear);
   }, [inFullscreen, repaintPausedFrame]);
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
      // A frame landing restarts the wait: skimming keeps a request pending the whole time
      // without being slow, and the indicator should only name a stall.
   }, [blocked, frameProgress]);
   useEffect(() => seeker.attach(videoRef.current!), [seeker, videoRef]);
   useEffect(() => {
      const video = videoRef.current!;
      if (!video.requestVideoFrameCallback) return;
      let callback = 0;
      const presented: VideoFrameRequestCallback = (_now, metadata) => {
         if (video.currentSrc === url) clock.displayFrame(url, metadata.mediaTime);
         callback = video.requestVideoFrameCallback(presented);
      };
      callback = video.requestVideoFrameCallback(presented);
      return () => video.cancelVideoFrameCallback(callback);
   }, [url, clock, videoRef]);
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
         videoRef.current.muted = muted || !audioIndices.length;
      }
   }, [volume, muted, videoRef, audioIndices.length]);
   useEffect(() => {
      if (videoRef.current && audioIndices.length === 1) selectNativeAudio(videoRef.current, source, audioIndices);
   }, [source, audioIndices, videoRef]);
   const stageClass = [
      "player-stage",
      !frameReady && !frameHeld && !failed ? "pending" : "",
      fullscreenPresence.mounted ? `fullscreen${fullscreenPresence.closing ? " closing" : ""}` : "",
      inFullscreen && !controlsShown ? "no-controls" : "",
   ]
      .filter(Boolean)
      .join(" ");
   const audioTracks = source.streams.filter((stream) => stream.type === "audio");
   return (
      <div
         className={stageClass}
         onPointerMove={inFullscreen ? wake : undefined}
         onClick={
            inFullscreen
               ? () => {
                    // A first click on a hidden overlay only reveals the controls; with them
                    // visible the picture itself toggles playback, like a media player.
                    if (!controlsShown) wake();
                    else onTogglePlay();
                 }
               : undefined
         }
         onDoubleClick={inFullscreen ? () => onSetFullscreen(false) : () => onSetFullscreen(true)}
      >
         <video
            ref={videoRef}
            className={frameReady ? `frame-ready${skipFrameFade ? " no-fade" : ""}` : ""}
            src={url}
            preload="auto"
            playsInline
            muted={muted || !audioIndices.length}
            aria-label={source.name}
            onPlaying={() => {
               onPlaying(true);
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
                  const resolved = clock.getResolved();
                  const target = Math.min(resolved === null ? clock.get() : presentationTime(resolved), source.duration);
                  if (Math.abs(videoRef.current.currentTime - target) > 0.00001) videoRef.current.currentTime = target;
               }
               if (
                  videoRef.current &&
                  audioIndices.length === 1 &&
                  !selectNativeAudio(videoRef.current, source, audioIndices) &&
                  playback.get().phase === "source"
               ) {
                  const tracks = source.streams.filter((stream) => stream.type === "audio");
                  const defaultTrack = tracks.find((track) => track.disposition["default"] === 1) ?? tracks[0];
                  if (defaultTrack && audioIndices[0] !== defaultTrack.index) {
                     onAudioFallback();
                     return;
                  }
               }
               if (videoRef.current && playWhenReady) void videoRef.current.play().catch(onFailure);
            }}
         />
         <canvas ref={snapshotRef} className={`preview-held-frame${frameHeld ? " visible" : ""}`} aria-hidden="true" />
         {blockedPresence.mounted && (
            <div className={`preview-loading delayed${blockedPresence.closing ? " closing" : ""}`} role="status" aria-hidden={blockedPresence.closing}>
               <span className="spinner" aria-hidden="true" />
               <span>{blockedPresence.value}</span>
            </div>
         )}
         {inFullscreen && (
            <div className={`fullscreen-controls${controlsShown ? "" : " hidden"}`}>
               <div className="fullscreen-bar" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                  <FullscreenProgress clock={clock} duration={source.duration} clips={clips} onSeek={onSeek} />
                  <div className="fullscreen-row">
                     <div className="fullscreen-group">
                        <IconButton
                           command="play"
                           icon={playing ? faPause : faPlay}
                           label={playing ? "Pause" : "Play"}
                           className="play-button"
                           data-playing={playing ? "" : undefined}
                        />
                        <IconButton command="previous" icon={faBackwardStep} label="Previous cut" />
                        <IconButton command="next" icon={faForwardStep} label="Next cut" />
                     </div>
                     <FullscreenTime clock={clock} duration={source.duration} />
                     <div className="fullscreen-group">
                        {audioTracks.length > 1 && <AudioPicker tracks={audioTracks} selected={audioIndices} onSelect={onAudio} />}
                        <IconButton
                           command="mute"
                           icon={muted || volume === 0 ? faVolumeXmark : faVolumeHigh}
                           label={muted || volume === 0 ? "Unmute preview" : "Mute preview"}
                        />
                        <VolumeSlider volume={volume} muted={muted} onChange={onVolume} />
                        <IconButton icon={faCompress} label="Exit fullscreen" shortcut="Esc" onClick={() => onSetFullscreen(false)} />
                     </div>
                  </div>
               </div>
            </div>
         )}
         <ExcludedHint clock={clock} clips={clips} duration={source.duration} trimming={trimming} />
      </div>
   );
}
function FullscreenTime({ clock, duration }: { clock: PlaybackClock; duration: number }) {
   const time = useClock(clock);
   return (
      <span className="fullscreen-time">
         <time>{formatTime(time)}</time>
         <span>/</span>
         <time>{formatTime(duration)}</time>
      </span>
   );
}
function FullscreenProgress({ clock, duration, clips, onSeek }: { clock: PlaybackClock; duration: number; clips: Clip[]; onSeek: (time: number) => void }) {
   const time = useClock(clock);
   const bar = useRef<HTMLDivElement>(null);
   const dragging = useRef(false);
   const seekTo = (clientX: number) => {
      const rect = bar.current!.getBoundingClientRect();
      onSeek(clamp((clientX - rect.left) / rect.width, 0, 1) * duration);
   };
   // Kept ranges take their timeline colors; the played span brightens everything it covers.
   const segments = (className: string) =>
      clips.map((clip) => (
         <span
            key={clip.id}
            className={className}
            style={
               {
                  left: `${(clip.start / duration) * 100}%`,
                  width: `${((clip.end - clip.start) / duration) * 100}%`,
                  "--clip-color": clipColor(clip.color),
               } as CSSProperties
            }
         />
      ));
   const fraction = duration > 0 ? clamp(time / duration, 0, 1) : 0;
   return (
      <div
         ref={bar}
         className="fullscreen-progress"
         role="slider"
         aria-label="Seek"
         aria-valuemin={0}
         aria-valuemax={Math.round(duration * 100) / 100}
         aria-valuenow={Math.round(time * 100) / 100}
         aria-valuetext={formatTime(time)}
         tabIndex={0}
         onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            seekTo(event.clientX);
         }}
         onPointerMove={(event) => {
            if (dragging.current) seekTo(event.clientX);
         }}
         onPointerUp={(event) => {
            dragging.current = false;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
         }}
         onPointerCancel={() => {
            dragging.current = false;
         }}
         onLostPointerCapture={() => {
            dragging.current = false;
         }}
         onKeyDown={(event) => {
            // Global shortcuts skip slider targets, so the bar carries its own steps.
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            const step = event.shiftKey ? 5 : 1;
            if (event.key === "ArrowLeft") {
               event.preventDefault();
               event.stopPropagation();
               onSeek(clamp(clock.get() - step, 0, duration));
            } else if (event.key === "ArrowRight") {
               event.preventDefault();
               event.stopPropagation();
               onSeek(clamp(clock.get() + step, 0, duration));
            } else if (event.key === "Home" || event.key === "End") {
               event.preventDefault();
               onSeek(event.key === "Home" ? 0 : duration);
            }
         }}
      >
         <div className="fullscreen-progress-track">{segments("fullscreen-progress-segment")}</div>
         <div className="fullscreen-progress-fill" style={{ clipPath: `inset(0 ${100 - fraction * 100}% 0 0)` }}>
            {segments("fullscreen-progress-segment")}
         </div>
         <i className="fullscreen-progress-knob" style={{ left: `${fraction * 100}%` }} />
      </div>
   );
}
function ExcludedHint({ clock, clips, duration, trimming }: { clock: PlaybackClock; clips: Clip[]; duration: number; trimming: boolean }) {
   const time = useFrameTime(clock);
   const included = insideClip(clips, time, duration);
   // While a handle drag pins the playhead onto a boundary, the draft is not yet the document.
   return <div className={`player-excluded ${included || trimming ? "hidden" : ""}`}>Not included in export</div>;
}
