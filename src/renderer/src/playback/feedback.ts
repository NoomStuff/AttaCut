/** What a key, click or wheel just did to playback, shown briefly over the video. */
export type PlayerCue = { kind: "play"; playing: boolean } | { kind: "skip"; seconds: number } | { kind: "volume"; percent: number };

/** Carries cues from commands to the player, which owns how they look. */
export class PlayerFeedback {
   private listeners = new Set<(cue: PlayerCue) => void>();
   subscribe = (listener: (cue: PlayerCue) => void): (() => void) => {
      this.listeners.add(listener);
      return () => {
         this.listeners.delete(listener);
      };
   };
   show(cue: PlayerCue): void {
      for (const listener of this.listeners) listener(cue);
   }
}

/** Skips this close together add up in one indicator, like +2s for two presses. */
export const skipStreakMs = 800;
/** Skips shorter than this don't show: the playhead had nowhere to go, like back at 0:00. */
export const minimumSkip = 0.05;

/** Whether a skip continues the running streak: soon after the last one, in the same direction. */
export function continuesStreak(previous: { seconds: number; at: number } | null, seconds: number, now: number): boolean {
   return !!previous && now - previous.at < skipStreakMs && Math.sign(previous.seconds) === Math.sign(seconds);
}
/** The total a skip indicator shows: the running streak when it continues. */
export function streakTotal(previous: { seconds: number; at: number } | null, seconds: number, now: number): number {
   return previous && continuesStreak(previous, seconds, now) ? previous.seconds + seconds : seconds;
}

/** Signed whole seconds, with minutes past a minute: +5s, −1:05. */
export function formatSkip(seconds: number): string {
   const total = Math.max(1, Math.round(Math.abs(seconds)));
   const sign = seconds < 0 ? "−" : "+";
   return total < 60 ? `${sign}${total}s` : `${sign}${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface VolumeLevel {
   volume: number;
   muted: boolean;
}
/** Volume steps by this much per key press or wheel notch. */
export const volumeStep = 0.05;

/**
 * One volume step. Stepping down past the bottom mutes and keeps the last level, which the next
 * step up comes back to. Null when nothing changes: already at the top, or already muted.
 */
export function steppedVolume(current: VolumeLevel, direction: -1 | 1): VolumeLevel | null {
   if (current.muted) return direction > 0 ? { volume: current.volume > 0 ? current.volume : volumeStep, muted: false } : null;
   const next = Math.round(Math.min(1, Math.max(0, current.volume + direction * volumeStep)) * 100) / 100;
   if (next <= 0) return { volume: current.volume, muted: true };
   return next === current.volume ? null : { volume: next, muted: false };
}
