import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Clip, MediaSource } from "../../../shared/types";
import type { PlaybackClock } from "../playback/clock";
import { useClock } from "../playback/clock";
import { insideClip } from "../editor/model";
import { Button } from "./Controls";
import { faPlay, faCircleExclamation } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
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
   failed,
   onFailure,
   onPrepare,
   preparing,
   progress,
   audioIndex,
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
   failed: boolean;
   onFailure: () => void;
   onPrepare: () => void;
   preparing: boolean;
   progress: number;
   audioIndex: number | null;
   seeker: PlaybackSeeker;
   onFullscreen: () => void;
   trimming: boolean;
}) {
   const latest = useRef({ clips, keptOnly, onPreviewEnd, failed });
   latest.current = { clips, keptOnly, onPreviewEnd, failed };
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
         if (video.readyState > 0 && !latest.current.failed && !video.seeking && !seeker.pending) clock.set(video.currentTime);
         frame = requestAnimationFrame(update);
      };
      frame = requestAnimationFrame(update);
      return () => cancelAnimationFrame(frame);
   }, [clock, previewEnd, videoRef, seeker]);
   useEffect(() => {
      if (videoRef.current) {
         videoRef.current.volume = volume;
         videoRef.current.muted = muted;
      }
   }, [volume, muted, videoRef]);
   useEffect(() => {
      if (videoRef.current) selectNativeAudio(videoRef.current, source, audioIndex);
   }, [source, audioIndex, videoRef]);
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
            onError={onFailure}
            onLoadedMetadata={() => {
               if (videoRef.current && videoRef.current.videoWidth === 0) {
                  onFailure();
                  return;
               }
               if (videoRef.current) videoRef.current.currentTime = Math.min(clock.get(), source.duration);
               if (videoRef.current) selectNativeAudio(videoRef.current, source, audioIndex);
            }}
            onDoubleClick={onFullscreen}
         />
         {failed && (
            <div className="player-fallback">
               <FontAwesomeIcon icon={faCircleExclamation} />
               <h3>{preparing ? "Preparing a playable preview" : "This video needs a compatible preview"}</h3>
               <p>Your clips will still export from the original file.</p>
               {preparing ? (
                  <>
                     <progress max={1} value={progress} />
                     <Button
                        onClick={() => {
                           void window.desktop.cancelPreview();
                        }}
                     >
                        Cancel
                     </Button>
                  </>
               ) : (
                  <Button icon={faPlay} onClick={onPrepare}>
                     Prepare preview
                  </Button>
               )}
            </div>
         )}
         {!failed && <ExcludedHint clock={clock} clips={clips} duration={source.duration} trimming={trimming} />}
      </div>
   );
}
function ExcludedHint({ clock, clips, duration, trimming }: { clock: PlaybackClock; clips: Clip[]; duration: number; trimming: boolean }) {
   const time = useClock(clock);
   const included = insideClip(clips, time, duration);
   // While a handle drag pins the playhead onto a boundary, the draft is not yet the document.
   return <div className={`player-excluded ${included || trimming ? "hidden" : ""}`}>Not included in export</div>;
}
