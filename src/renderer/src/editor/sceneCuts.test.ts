import { expect, it } from "vitest";
import { clipLimit } from "../../../shared/defaults";
import { editorReducer, emptyEditor, splitAtSceneCuts, type EditDocument } from "./model";

const document: EditDocument = {
   clips: [
      { id: "a", start: 0, end: 4, color: 0 },
      { id: "b", start: 6, end: 10, color: 1 },
   ],
   selectedId: "a",
};

it("splits only kept footage, preserves boundaries and selection, and undoes the scan in one step", () => {
   const next = splitAtSceneCuts(document, [8, 2, 2, 0, 4, 5, 6, 10, NaN, Infinity]);
   expect(next.clips.map(({ start, end }) => [start, end])).toEqual([
      [0, 2],
      [2, 4],
      [6, 8],
      [8, 10],
   ]);
   expect(next.selectedId).toBe("a");
   expect(next.clips[0]!.id).toBe("a");
   expect(next.clips[2]!.id).toBe("b");
   const edited = editorReducer({ ...emptyEditor, document }, { type: "commit", document: next });
   expect(editorReducer(edited, { type: "undo" }).document).toBe(document);
   expect(editorReducer(editorReducer(edited, { type: "undo" }), { type: "redo" }).document).toBe(next);
   expect(splitAtSceneCuts(next, [2, 8])).toBe(next);
});

it("refuses to apply partial results when the timeline would exceed the clip limit", () => {
   const full = { ...document, clips: Array.from({ length: clipLimit }, (_, i) => ({ id: `${i}`, start: i * 2, end: i * 2 + 2, color: 0 })) };
   expect(() => splitAtSceneCuts(full, [1])).toThrow("exceed");
   expect(full.clips).toHaveLength(clipLimit);
});
