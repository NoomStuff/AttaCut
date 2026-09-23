import type { Preferences } from "./types";

// Renderer defaults must stay independent of the main process validation library.
export const clipColorCount = 5;
/** Deepest undo stack, both in memory and on disk. */
export const undoLimit = 200;
export const defaultPreferences: Preferences = {
   theme: "dark",
   accent: 0,
   outputDirectory: "",
   keptOnly: false,
   keepPlaying: false,
   audioScrub: false,
   snapping: false,
   volume: 0.7,
   shortcuts: {},
   exportMode: "separate",
   playbackAudio: { mode: "default", sourceTrackCount: 0, tracks: [] },
   exportAudio: { mode: "default", sourceTrackCount: 0, tracks: [] },
   frameFormat: "png",
   frameQuality: 95,
};
