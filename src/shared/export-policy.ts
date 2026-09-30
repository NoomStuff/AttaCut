import type { CutReport } from "./types";

/** Consent threshold, never a codec or accuracy restriction. */
export function substantialEncoding(item: Pick<CutReport, "clip" | "encodedSeconds" | "duration">): boolean {
   const duration = item.duration ?? item.clip.end - item.clip.start;
   return item.encodedSeconds > 12 || (duration > 12 && item.encodedSeconds > duration * 0.5);
}
