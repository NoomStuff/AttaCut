import { describe, expect, it } from "vitest";
import type { AudioSelectionPreference, MediaStream } from "../../../shared/types";
import { rememberAudioSelection, resolveAudioSelection } from "./audioSelection";

const track = (index: number, title: string, language = "") => ({ index, title, language, disposition: {}, type: "audio" }) as MediaStream;

describe("audio selection memory", () => {
   it("keeps all selected when the next source has a different track layout", () => {
      const saved = rememberAudioSelection([track(1, "Game"), track(2, "Mic")], [1, 2]);
      expect(resolveAudioSelection([track(4, "Mix"), track(7, "Music"), track(9, "Voice")], saved)).toEqual([4, 7, 9]);
   });
   it("defaults playback to one track and export to every track", () => {
      const tracks = [track(1, "Game"), track(2, "Mic")];
      const preference: AudioSelectionPreference = { mode: "default", sourceTrackCount: 0, tracks: [] };
      expect(resolveAudioSelection(tracks, preference)).toEqual([1]);
      expect(resolveAudioSelection(tracks, preference, true)).toEqual([1, 2]);
   });
   it("matches named tracks before falling back to positions", () => {
      const saved = rememberAudioSelection([track(1, "Game"), track(2, "Commentary", "nld")], [2]);
      expect(resolveAudioSelection([track(8, "Commentary", "nld"), track(9, "Game")], saved)).toEqual([8]);
      expect(resolveAudioSelection([track(8, "Mix"), track(9, "Voice")], saved)).toEqual([9]);
   });
   it("falls back to the default track when the new layout no longer matches", () => {
      const saved = rememberAudioSelection([track(1, "Game"), track(2, "Mic")], [2]);
      const replacement = [track(4, "Main"), track(5, "Alt"), track(6, "AD")];
      replacement[1]!.disposition["default"] = 1;
      expect(resolveAudioSelection(replacement, saved)).toEqual([5]);
   });
   it("remembers disabled audio for single-track exports", () => {
      const saved = rememberAudioSelection([track(1, "Main")], []);
      expect(resolveAudioSelection([track(3, "Main")], saved)).toEqual([]);
   });
});
