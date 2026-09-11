import { expect, it } from "vitest";
import { clipColor, distinctClipColors } from "./colors";
import { deleteClip, editorReducer, emptyEditor, newDocument, splitClip } from "./model";

it("keeps identities unique and neighboring base colors distinct through repeated splits and deletes", () => {
   let state = editorReducer(emptyEditor, { type: "load", document: newDocument(100) });
   for (let index = 1; index < 30; index++) {
      const first = state.document.clips[0]!;
      state = editorReducer(state, { type: "commit", document: splitClip({ ...state.document, selectedId: first.id }, (first.start + first.end) / 2, 0) });
      const clips = state.document.clips;
      expect(new Set(clips.map((clip) => clipColor(clip.color))).size).toBe(clips.length);
      expect(clips.every((clip, i) => i === 0 || clip.color % 6 !== clips[i - 1]!.color % 6)).toBe(true);
   }
   for (let index = 0; index < 20; index++) {
      state = editorReducer(state, { type: "commit", document: deleteClip({ ...state.document, selectedId: state.document.clips[1]!.id }) });
      expect(state.document.clips.every((clip, i, clips) => i === 0 || clip.color % 6 !== clips[i - 1]!.color % 6)).toBe(true);
   }
});

it("repairs old color collisions without changing timing or already distinct colors", () => {
   const clips = [0, 1, 6, 0, 0].map((color, index) => ({ id: String(index), start: index, end: index + 1, color }));
   const repaired = distinctClipColors(clips);
   expect(repaired.slice(0, 3)).toEqual(clips.slice(0, 3));
   expect(repaired.map(({ id, start, end }) => ({ id, start, end }))).toEqual(clips.map(({ id, start, end }) => ({ id, start, end })));
   expect(distinctClipColors(repaired)).toEqual(repaired);
});
