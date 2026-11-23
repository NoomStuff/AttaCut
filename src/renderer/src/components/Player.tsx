import { audioStreams } from "../../../shared/media";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, RefObject, WheelEvent as ReactWheelEvent } from "react";
import type { Clip, MediaSource } from "../../../shared/types";
import type { PlaybackClock } from "../playback/clock";
import { useClock, useFrameTime } from "../playback/clock";
import { insideClip } from "../editor/model";
import { clipColor } from "../editor/colors";
import { selectNativeAudio } from "../playback/audio";
import type { PlaybackController, PlaybackState } from "../playback/controller";
import type { PlaybackSeeker } from "../playback/seeker";
import { nextKeptTime } from "../playback/ranges";
import { useExitValue } from "../lib/motion";
import { presentationTime } from "../playback/presentation";
import { connectPlayback } from "../playback/transport";
import { clamp, formatTime } from "../../../shared/time";
import { IconButton } from "./Controls";
import { SpeedPicker } from "./SpeedPicker";
import type { PlaybackSpeed } from "../playback/speed";
import { AudioPicker } from "./AudioPicker";
import { VolumeControl } from "./VolumeControl";
import type { PlayerFeedback } from "../playback/feedback";
import { continuesStreak, formatSkip } from "../playback/feedback";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
   faPlay,
   faPause,
   faBackwardStep,
   faForwardStep,
   faCompress,
   faBackward,
   faForward,
   faVolumeHigh,
   faVolumeLow,
   faVolumeOff,
   faVolumeXmark,
} from "@fortawesome/free-solid-svg-icons";

/** How long a press on the video waits before it counts as holding, which plays at double speed. */
const holdMs = 350;
/** Wheel travel per volume step: one notch of a mouse wheel. */
const wheelStep = 100;
/** A pause in wheel input this long starts a new gesture, so trackpad leftovers don't step later. */
const wheelGestureMs = 400;
/** How long a skip or volume indicator stays up after its last change. */
const cueMs = 650;

export function Player({
   source,
   state,
   videoRef,
   playback,
   clock,
   clips,
   keptOnly,
   speed,
   onSpeed,
   volume,
   muted,
   onPlaying,
   onFailure,
   onAudioFallback,
   audioIndices,
   onAudio,
   onVolume,
   onSeek,
   seeker,
   fullscreen,
   returningFromFullscreen,
   onFullscreenReturnEnd,
   onSetFullscreen,
   onTogglePlay,
   trimming,
   feedback,
   onStepVolume,
}: {
   source: MediaSource;
   state: PlaybackState;
   videoRef: RefObject<HTMLVideoElement | null>;
   playback: PlaybackController;
   clock: PlaybackClock;
   clips: Clip[];
   keptOnly: boolean;
   speed: PlaybackSpeed;
   onSpeed: (speed: PlaybackSpeed) => void;
   volume: number;
   muted: boolean;
   onPlaying: (playing: boolean) => void;
   onFailure: () => void;
   onAudioFallback: () => void;
   audioIndices: number[];
   onAudio: (indices: number[]) => void;
   onVolume: (value: number, restore: number) => void;
   onSeek: (time: number) => void;
   seeker: PlaybackSeeker;
   fullscreen: boolean;
   returningFromFullscreen: boolean;
   onFullscreenReturnEnd: () => void;
   onSetFullscreen: (value: boolean) => void;
   onTogglePlay: () => void;
   trimming: boolean;
   feedback: PlayerFeedback;
   onStepVolume: (direction: -1 | 1) => void;
}) {
   const { url, intent, phase, showWait: waitForPlay } = state;
   const preparing = phase === "preparing";
   const failed = phase === "failed";
   const playing = intent === "playing";
   const playActive = intent !== "paused";
   const [readyUrl, setReadyUrl] = useState<string | null>(null);
   const playbackFailure = useEffectEvent(onFailure);
   useEffect(() => connectPlayback(videoRef.current!, playback, seeker, () => playbackFailure()), [videoRef, playback, seeker]);
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
   // Fullscreen follows the native window immediately. Returning motion runs
   // inside the normal preview, with the same mounted video and decoded frame.
   const inFullscreen = fullscreen;
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
         if (video.currentSrc === url && !video.seeking) clock.displayFrame(url, metadata.mediaTime);
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
               if (next === null) {
                  seeker.seek(latest.current.clips.at(-1)!.end);
                  playback.reachedEnd = true;
               } else if (next !== video.currentTime) seeker.seek(next, true);
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
   useLayoutEffect(() => {
      const video = videoRef.current;
      if (!video) return;
      video.defaultPlaybackRate = speed;
      video.playbackRate = speed;
      video.preservesPitch = true;
   }, [speed, url, videoRef]);
   useEffect(() => {
      if (videoRef.current && audioIndices.length === 1) selectNativeAudio(videoRef.current, source, audioIndices);
   }, [source, audioIndices, videoRef]);
   // Cues over the video for what a click, key or wheel just did. Skips and volume steps that
   // arrive while one shows update it in place, so a held key reads as one climbing number.
   const [flash, setFlash] = useState<{ id: number; playing: boolean } | null>(null);
   const [skip, setSkip] = useState<{ streak: number; pulse: number; seconds: number } | null>(null);
   const [level, setLevel] = useState<{ streak: number; percent: number } | null>(null);
   // The skip mark leaves like the play flash, growing as it fades, which takes a little longer.
   const skipPresence = useExitValue(skip, 320);
   const levelPresence = useExitValue(level, 200);
   useEffect(() => {
      let streak: { id: number; seconds: number; at: number } | null = null;
      let skipTimer = 0;
      let levelTimer = 0;
      let levelStreak = 0;
      const unsubscribe = feedback.subscribe((cue) => {
         const now = performance.now();
         if (cue.kind === "play") {
            setFlash({ id: now, playing: cue.playing });
         } else if (cue.kind === "skip") {
            streak = continuesStreak(streak, cue.seconds, now)
               ? { id: streak!.id, seconds: streak!.seconds + cue.seconds, at: now }
               : { id: now, seconds: cue.seconds, at: now };
            const current = streak;
            setSkip({ streak: current.id, pulse: now, seconds: current.seconds });
            window.clearTimeout(skipTimer);
            skipTimer = window.setTimeout(() => setSkip(null), cueMs);
         } else {
            if (!levelTimer) levelStreak = now;
            const id = levelStreak;
            setLevel({ streak: id, percent: cue.percent });
            window.clearTimeout(levelTimer);
            levelTimer = window.setTimeout(() => {
               levelTimer = 0;
               setLevel(null);
            }, cueMs);
         }
      });
      return () => {
         unsubscribe();
         window.clearTimeout(skipTimer);
         window.clearTimeout(levelTimer);
      };
   }, [feedback]);
   // Holding the video plays at double speed until release. The release is not a click.
   const [boosted, setBoosted] = useState(false);
   const boostPresence = useExitValue(boosted ? Math.max(2, speed) : null, 200);
   const hold = useRef<{ timer: number; boosted: boolean; swallowClick: boolean }>({ timer: 0, boosted: false, swallowClick: false });
   const speedRef = useRef(speed);
   speedRef.current = speed;
   const endHold = useCallback(() => {
      window.clearTimeout(hold.current.timer);
      hold.current.timer = 0;
      if (!hold.current.boosted) return false;
      hold.current.boosted = false;
      setBoosted(false);
      if (videoRef.current) videoRef.current.playbackRate = speedRef.current;
      return true;
   }, [videoRef]);
   useEffect(() => () => void endHold(), [endHold, url]);
   // The second click of a double-click that started somewhere else, like the file that opened
   // this video, isn't meant for the player.
   const press = useRef({ at: 0, paired: false });
   const wheel = useRef({ travel: 0, at: 0 });
   const wheelVolume = (event: ReactWheelEvent<HTMLDivElement>) => {
      if (event.ctrlKey || event.metaKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      if (event.target instanceof Element && event.target.closest(".fullscreen-bar")) return;
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 33 : event.deltaY;
      const now = performance.now();
      // Reversing direction or pausing starts over, so a step never needs undoing first.
      if (now - wheel.current.at > wheelGestureMs || Math.sign(wheel.current.travel) !== Math.sign(delta)) wheel.current.travel = 0;
      wheel.current.at = now;
      wheel.current.travel += delta;
      while (Math.abs(wheel.current.travel) >= wheelStep) {
         onStepVolume(wheel.current.travel < 0 ? 1 : -1);
         wheel.current.travel -= Math.sign(wheel.current.travel) * wheelStep;
      }
   };
   const stageClass = [
      "player-stage",
      !frameReady && !frameHeld && !failed ? "pending" : "",
      inFullscreen ? "fullscreen" : "",
      returningFromFullscreen ? "fullscreen-returning" : "",
      inFullscreen && !controlsShown ? "no-controls" : "",
   ]
      .filter(Boolean)
      .join(" ");
   const audioTracks = audioStreams(source);
   return (
      <div
         className={stageClass}
         onAnimationEnd={(event) => {
            if (event.target === event.currentTarget && event.animationName === "fullscreen-return") onFullscreenReturnEnd();
         }}
         onPointerMove={inFullscreen ? wake : undefined}
         // The whole stage answers, letterboxing included: a click plays or pauses, a double-click
         // toggles fullscreen, and holding plays at double speed until released.
         onPointerDown={(event) => {
            if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".fullscreen-bar"))) return;
            const now = performance.now();
            press.current = { at: now, paired: now - press.current.at < 500 };
            hold.current.swallowClick = false;
            const video = videoRef.current;
            if (!video || video.paused) return;
            window.clearTimeout(hold.current.timer);
            hold.current.timer = window.setTimeout(() => {
               hold.current.timer = 0;
               if (video.paused) return;
               hold.current.boosted = true;
               video.playbackRate = Math.max(2, speedRef.current);
               setBoosted(true);
            }, holdMs);
         }}
         onPointerUp={() => {
            if (endHold()) hold.current.swallowClick = true;
         }}
         onPointerCancel={endHold}
         onPointerLeave={endHold}
         onDragStart={endHold}
         onWheel={wheelVolume}
         onClick={(event) => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            if (hold.current.swallowClick) {
               hold.current.swallowClick = false;
               return;
            }
            if (event.detail > 1 && !press.current.paired) return;
            onTogglePlay();
            feedback.show({ kind: "play", playing: playback.get().intent !== "paused" });
            if (inFullscreen) wake();
         }}
         onDoubleClick={() => {
            if (press.current.paired) onSetFullscreen(!inFullscreen);
         }}
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
               if (playback.previewEnd === null) playback.reachedEnd = true;
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
                  const tracks = audioStreams(source);
                  const defaultTrack = tracks.find((track) => track.disposition["default"] === 1) ?? tracks[0];
                  if (defaultTrack && audioIndices[0] !== defaultTrack.index) {
                     onAudioFallback();
                     return;
                  }
               }
            }}
         />
         <canvas ref={snapshotRef} className={`preview-held-frame${frameHeld ? " visible" : ""}`} aria-hidden="true" />
         {blockedPresence.mounted && (
            <div className={`preview-loading delayed${blockedPresence.closing ? " closing" : ""}`} role="status" aria-hidden={blockedPresence.closing}>
               <span className="spinner" aria-hidden="true" />
               <span>{blockedPresence.value}</span>
            </div>
         )}
         {flash && (
            <span key={flash.id} className="player-flash" aria-hidden="true" onAnimationEnd={() => setFlash(null)}>
               <FontAwesomeIcon icon={flash.playing ? faPlay : faPause} />
            </span>
         )}
         {skipPresence.value && (
            <span
               key={skipPresence.value.streak}
               className={`player-skip${skipPresence.closing ? " closing" : ""}`}
               data-side={skipPresence.value.seconds < 0 ? "back" : "forward"}
               aria-hidden="true"
            >
               <span className="player-skip-mark">
                  <FontAwesomeIcon key={skipPresence.value.pulse} icon={skipPresence.value.seconds < 0 ? faBackward : faForward} />
               </span>
               <span key={skipPresence.value.pulse} className="player-skip-amount">
                  {formatSkip(skipPresence.value.seconds)}
               </span>
            </span>
         )}
         {levelPresence.value && !boostPresence.value && (
            <span key={levelPresence.value.streak} className={`player-pill${levelPresence.closing ? " closing" : ""}`} aria-hidden="true">
               <FontAwesomeIcon
                  icon={
                     levelPresence.value.percent === 0
                        ? faVolumeXmark
                        : levelPresence.value.percent < 33
                          ? faVolumeOff
                          : levelPresence.value.percent < 67
                            ? faVolumeLow
                            : faVolumeHigh
                  }
                  fixedWidth
               />
               <span className="player-level-track">
                  <i style={{ transform: `scaleX(${levelPresence.value.percent / 100})` }} />
               </span>
               <span className="player-level-value">{levelPresence.value.percent}%</span>
            </span>
         )}
         {boostPresence.value && (
            <span
               className={`player-pill player-boost${boostPresence.closing ? " closing" : ""}`}
               role="status"
               aria-label={`Playing at ${boostPresence.value}× speed`}
            >
               <span className="player-boost-arrows" aria-hidden="true">
                  <FontAwesomeIcon icon={faPlay} />
                  <FontAwesomeIcon icon={faPlay} />
               </span>
               {boostPresence.value}×
            </span>
         )}
         {inFullscreen && (
            <div className={`fullscreen-controls${controlsShown ? "" : " hidden"}`}>
               <div className="fullscreen-bar" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                  <FullscreenProgress clock={clock} duration={source.duration} clips={clips} onSeek={onSeek} />
                  <div className="fullscreen-row">
                     <div className="fullscreen-group">
                        <IconButton
                           command="play"
                           icon={playActive ? faPause : faPlay}
                           label={playActive ? "Pause" : "Play"}
                           className="play-button"
                           data-playing={playActive ? "" : undefined}
                        />
                        <IconButton command="previous" icon={faBackwardStep} label="Previous cut" />
                        <IconButton command="next" icon={faForwardStep} label="Next cut" />
                     </div>
                     <FullscreenTime clock={clock} duration={source.duration} />
                     <div className="fullscreen-group">
                        <SpeedPicker speed={speed} onChange={onSpeed} />
                        {audioTracks.length > 1 && <AudioPicker tracks={audioTracks} selected={audioIndices} onSelect={onAudio} />}
                        <VolumeControl volume={volume} muted={muted} onChange={onVolume} />
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
   // One element list renders twice: once in the track, once inside the played-span fill.
   const segments = useMemo(
      () =>
         clips.map((clip) => (
            <span
               key={clip.id}
               className="fullscreen-progress-segment"
               style={
                  {
                     left: `${(clip.start / duration) * 100}%`,
                     width: `${((clip.end - clip.start) / duration) * 100}%`,
                     "--clip-color": clipColor(clip.color),
                  } as CSSProperties
               }
            />
         )),
      [clips, duration]
   );
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
         <div className="fullscreen-progress-track">{segments}</div>
         <div className="fullscreen-progress-fill" style={{ clipPath: `inset(0 ${100 - fraction * 100}% 0 0)` }}>
            {segments}
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
