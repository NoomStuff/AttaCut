/** Chromium seeks in microseconds. Stay inside the resolved frame when its rational timestamp rounds down. */
export function presentationTime(frame: number): number {
   return frame + 0.000001;
}
