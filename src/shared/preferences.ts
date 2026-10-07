import { z } from "zod";
import { clipColorCount } from "./defaults";
export const audioSelectionPreferenceSchema = z.object({
   mode: z.enum(["default", "all", "tracks"]).default("default"),
   sourceTrackCount: z.number().int().nonnegative().default(0),
   tracks: z
      .array(
         z.object({
            position: z.number().int().nonnegative(),
            title: z.string(),
            language: z.string(),
         })
      )
      .default([]),
});
export type AudioSelectionPreference = z.infer<typeof audioSelectionPreferenceSchema>;
export const preferencesSchema = z.object({
   theme: z.enum(["dark", "system", "light"]).default("dark"),
   accent: z
      .number()
      .int()
      .min(0)
      .max(clipColorCount - 1)
      .default(0),
   outputDirectory: z.string().default(""),
   keptOnly: z.boolean().default(false),
   keepPlaying: z.boolean().default(false),
   audioScrub: z.boolean().default(true),
   waveform: z.boolean().default(false),
   snapping: z.boolean().default(false),
   holdToSnap: z.enum(["Alt", "Shift", "Control", "none"]).default("Alt"),
   volume: z.number().min(0).max(1).default(0.7),
   resume: z.boolean().default(true),
   updateCheck: z.boolean().default(true),
   shortcuts: z.record(z.string(), z.array(z.string())).default({}),
   exportMode: z.enum(["separate", "combined"]).default("separate"),
   clipNamePattern: z.string().default("{source} ({n})"),
   combinedNamePattern: z.string().default("{source} (Trim)"),
   playbackAudio: audioSelectionPreferenceSchema.default({ mode: "default", sourceTrackCount: 0, tracks: [] }),
   exportAudio: audioSelectionPreferenceSchema.default({ mode: "default", sourceTrackCount: 0, tracks: [] }),
   frameFormat: z.enum(["png", "jpg"]).default("png"),
   frameQuality: z.number().min(1).max(100).default(95),
});
export type Preferences = z.infer<typeof preferencesSchema>;
