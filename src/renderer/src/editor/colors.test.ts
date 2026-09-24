import { expect, it } from "vitest";
import { clipColor, nextClipColor } from "./colors";
import { deleteClip, editorReducer, emptyEditor, newDocument, splitClip } from "./model";

it("keeps identities unique and neighboring base colors distinct through repeated splits", () => {
   let state = editorReducer(emptyEditor, { type: "load", document: newDocument(100) });
   for (let index = 1; index < 30; index++) {
      const first = state.document.clips[0]!;
      state = editorReducer(state, { type: "commit", document: splitClip(state.document, first.id, (first.start + first.end) / 2, 0) });
      const clips = state.document.clips;
      expect(new Set(clips.map((clip) => clipColor(clip.color))).size).toBe(clips.length);
      expect(clips.every((clip, i) => i === 0 || clip.color % 5 !== clips[i - 1]!.color % 5)).toBe(true);
   }
});

it("skips both neighboring base colours when continuing the sequence", () => {
   const clips = [0, 1, 4].map((color, index) => ({ id: String(index), start: index, end: index + 1, color }));
   expect(nextClipColor(clips, clips[0], clips[1])).toBe(7);
});

it("does not recolour existing clips when an edit makes equal base colours adjacent", () => {
   const clips = [0, 2, 5].map((color, index) => ({ id: String(index), start: index, end: index + 1, color }));
   const document = { clips, selectedId: "1" };
   const committed = editorReducer({ ...emptyEditor, document }, { type: "commit", document: deleteClip(document, "1") });
   expect(committed.document.clips.map((clip) => clip.color)).toEqual([0, 5]);
});

it("hue-shifts each pass through the five base colours", () => {
   expect(clipColor(0)).toBe("var(--clip-sequence-0, var(--clip-0))");
   expect(clipColor(5)).toContain("h + 7");
   expect(clipColor(10)).toContain("h + 14");
});
