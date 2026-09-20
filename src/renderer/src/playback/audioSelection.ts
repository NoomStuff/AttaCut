import type { AudioSelectionPreference, MediaStream } from "../../../shared/types";

const key = (value: string) => value.trim().toLocaleLowerCase();

export function resolveAudioSelection(tracks: MediaStream[], preference: AudioSelectionPreference, defaultAll = false): number[] {
   if (!tracks.length) return [];
   if (preference.mode === "default") {
      if (defaultAll) return tracks.map((track) => track.index);
      return [tracks.find((track) => track.disposition["default"] === 1)?.index ?? tracks[0]!.index];
   }
   if (tracks.length === 1) return preference.mode === "tracks" && preference.sourceTrackCount === 1 && !preference.tracks.length ? [] : [tracks[0]!.index];
   if (preference.mode === "all") return tracks.map((track) => track.index);

   const matched: number[] = [];
   for (const saved of preference.tracks) {
      if (!saved.title) continue;
      const match = tracks.find(
         (track) => !matched.includes(track.index) && key(track.title) === key(saved.title) && key(track.language) === key(saved.language)
      );
      if (match) matched.push(match.index);
   }
   if (matched.length === preference.tracks.length && matched.length) return matched;
   if (tracks.length === preference.sourceTrackCount) {
      const positions = preference.tracks.map((track) => tracks[track.position]?.index).filter((index): index is number => index !== undefined);
      if (positions.length) return positions;
   }
   return [tracks.find((track) => track.disposition["default"] === 1)?.index ?? tracks[0]!.index];
}

export function rememberAudioSelection(tracks: MediaStream[], selected: number[]): AudioSelectionPreference {
   if (tracks.length > 1 && selected.length === tracks.length) return { mode: "all", sourceTrackCount: tracks.length, tracks: [] };
   return {
      mode: "tracks",
      sourceTrackCount: tracks.length,
      tracks: tracks.flatMap((track, position) =>
         selected.includes(track.index) ? [{ position, title: track.title.trim(), language: track.language.trim() }] : []
      ),
   };
}

export function audioTrackLabel(track: MediaStream, position: number): string {
   const language = ["und", "unknown", "unspecified"].includes(key(track.language)) ? "" : track.language;
   const details = [track.title || `Track ${position + 1}`, language].filter(Boolean);
   return details.join(" · ");
}
