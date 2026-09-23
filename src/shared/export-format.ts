import type { MediaSource, Clip } from "./types";

/** A separate export spanning the whole source keeps the source container; everything else exports to the export container. */
export function exportExtensionFor(
   source: Pick<MediaSource, "extension" | "exportExtension" | "duration">,
   clip: Pick<Clip, "start" | "end">,
   options: { separate: boolean; allAudio: boolean }
): string {
   const fullRange = clip.start === 0 && Math.abs(clip.end - source.duration) < 0.0001;
   return options.allAudio && options.separate && fullRange ? source.extension : source.exportExtension;
}
