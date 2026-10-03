import type { Preferences } from "./preferences";

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
   audioScrub: true,
   waveform: false,
   snapping: false,
   holdToSnap: "Alt",
   volume: 0.7,
   resume: true,
   updateCheck: true,
   shortcuts: {},
   exportMode: "separate",
   clipNamePattern: "{source} ({n})",
   combinedNamePattern: "{source} (Trim)",
   playbackAudio: { mode: "default", sourceTrackCount: 0, tracks: [] },
   exportAudio: { mode: "default", sourceTrackCount: 0, tracks: [] },
   frameFormat: "png",
   frameQuality: 95,
};
