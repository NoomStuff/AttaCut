import { describe, expect, it } from "vitest";
import {
   clipAt,
   ClipPriority,
   gapAt,
   mergePair,
   mergeClips,
   addGap,
   deleteClip,
   editorReducer,
   emptyEditor,
   insideClip,
   minClipLength,
   splitClip,
   timeEpsilon,
   trimClip,
} from "./model";
import type { EditDocument } from "./model";
import { undoLimit } from "../../../shared/types";
const source: EditDocument = { clips: [{ id: "a", start: 0, end: 120, color: 0 }], selectedId: "a" };
describe("source-time editing", () => {
   it("splits, trims a gap, and undoes the whole edit without moving other clips", () => {
      const trimmed = trimClip(trimClip(source, "a", "start", 10, 120), "a", "end", 100, 120);
      const split = splitClip(trimmed, 40);
      const right = split.clips[1]!;
      const state = editorReducer({ ...emptyEditor, document: split }, { type: "commit", document: trimClip(split, right.id, "start", 55, 120) });
      expect(state.document.clips.map(({ start, end }) => [start, end])).toEqual([
         [10, 40],
         [55, 100],
      ]);
      expect(editorReducer(state, { type: "undo" }).document).toEqual(split);
   });
   it("clamps boundaries to neighbors but permits restoring into gaps", () => {
      const split = splitClip(source, 40);
      const trimmed = trimClip(split, split.selectedId!, "start", 55, 120);
      expect(trimClip(trimmed, "a", "end", 70, 120).clips[0]!.end).toBe(55);
      expect(trimClip(trimmed, split.selectedId!, "start", 10, 120).clips[1]!.start).toBe(40);
   });
   it("does not split at endpoints or outside the selected clip", () => {
      expect(splitClip(source, 0)).toBe(source);
      expect(splitClip(source, 120)).toBe(source);
      expect(splitClip(source, 150)).toBe(source);
   });
   it("recovers an empty timeline and clears redo on a new edit", () => {
      const deleted = deleteClip(source);
      expect(deleted.clips).toEqual([]);
      expect(addGap(deleted, 50, 120).clips[0]).toMatchObject({ start: 0, end: 120 });
      const committed = editorReducer({ ...emptyEditor, document: source }, { type: "commit", document: deleted });
      const undone = editorReducer(committed, { type: "undo" });
      expect(editorReducer(undone, { type: "commit", document: splitClip(source, 50) }).future).toEqual([]);
   });
   it("caps the undo history at undoLimit previous states", () => {
      let state = { ...emptyEditor, document: source };
      for (let index = 1; index <= undoLimit + 50; index++)
         state = editorReducer(state, { type: "commit", document: trimClip(source, "a", "end", 120 - index / 10, 120) });
      expect(state.past.length).toBe(undoLimit);
      expect(state.past[0]!.clips[0]!.end).toBeCloseTo(115);
      expect(state.past.at(-1)!.clips[0]!.end).toBeCloseTo(95.1);
      const undone = editorReducer(state, { type: "undo" });
      expect(undone.document.clips[0]!.end).toBeCloseTo(95.1);
      expect(undone.future[0]!.clips[0]!.end).toBeCloseTo(95);
   });
   it("restores undo and redo history with a loaded document", () => {
      const past = [{ clips: [], selectedId: null }];
      const future = [source];
      const loaded = editorReducer(emptyEditor, { type: "load", document: source, past, future });
      expect(loaded.past).toEqual(past);
      expect(loaded.future).toEqual(future);
      expect(editorReducer(loaded, { type: "undo" }).document).toEqual(past[0]);
      expect(editorReducer(editorReducer(loaded, { type: "undo" }), { type: "redo" }).document).toEqual(loaded.document);
   });
});
describe("playhead inclusion", () => {
   const clips = [
      { id: "a", start: 0, end: 10, color: 0 },
      { id: "b", start: 20, end: 30, color: 1 },
   ];
   it("counts exact boundaries and sub-step rounding as kept", () => {
      expect(insideClip(clips, 0, 30)).toBe(true);
      expect(insideClip(clips, 10, 30)).toBe(true);
      expect(insideClip(clips, 20, 30)).toBe(true);
      expect(insideClip(clips, 10 + timeEpsilon / 2, 30)).toBe(true);
      expect(insideClip(clips, 10 - timeEpsilon / 2, 30)).toBe(true);
      expect(insideClip(clips, 30 + 0.0000009, 30)).toBe(true);
      expect(insideClip(clips, -0.0000009, 30)).toBe(true);
   });
   it("still excludes gaps past the edit step", () => {
      expect(insideClip([], 5, 30)).toBe(false);
      expect(insideClip(clips, 15, 30)).toBe(false);
      expect(insideClip(clips, 10 + timeEpsilon * 2, 30)).toBe(false);
      expect(insideClip(clips, 20 - timeEpsilon * 2, 30)).toBe(false);
   });
});

it("keeps two frames at maximum zoom and scales the drag floor with the view", () => {
   expect(minClipLength(0.5, 1 / 30)).toBeCloseTo(2 / 30);
   expect(minClipLength(120, 1 / 30)).toBeCloseTo(1.8);
   const floor = minClipLength(0.5, 1 / 30);
   expect(splitClip(source, 1 / 30, floor)).toBe(source);
   expect(splitClip(source, 120 - 1 / 30, floor)).toBe(source);
   expect(trimClip(source, "a", "start", 120, 120, floor).clips[0]!.start).toBeCloseTo(120 - floor);
});

describe("merge and playhead targeting", () => {
   it("merges a split in one undoable edit", () => {
      const split = splitClip(source, 40);
      expect(mergePair(split, 40, 1 / 30, 0.1)).toBe(0);
      expect(mergePair(split, 41, 1 / 30, 0.1)).toBe(-1);
      const merged = mergeClips(split, 0);
      expect(merged).toEqual(source);
      const state = editorReducer({ ...emptyEditor, document: split }, { type: "commit", document: merged });
      expect(editorReducer(state, { type: "undo" }).document).toEqual(split);
   });
   it("allows a one-frame gap but rejects a removed section", () => {
      const split = splitClip(source, 40);
      const near = trimClip(split, split.selectedId!, "start", 40 + 1 / 30, 120);
      expect(mergePair(near, 40, 1 / 30, 0.1)).toBe(0);
      const gap = trimClip(split, split.selectedId!, "start", 41, 120);
      expect(mergePair(gap, 40.5, 1 / 30, 1)).toBe(-1);
   });
   it("targets the clip under playback, the right clip at a seam, and no clip in a gap", () => {
      const split = splitClip(source, 40);
      expect(clipAt(split, 10)?.id).toBe("a");
      expect(clipAt(split, 40)?.id).toBe(split.selectedId);
      expect(clipAt(split, 120)?.id).toBe(split.selectedId);
      expect(clipAt(trimClip(split, split.selectedId!, "start", 50, 120), 45)).toBeUndefined();
   });
});

describe("clip interaction priority", () => {
   const a = { id: "a", start: 5, end: 10, color: 0 };
   const b = { id: "b", start: 10, end: 20, color: 1 };
   const document = { clips: [a, b], selectedId: "b" };
   it("uses the last interaction at a shared edge, independently of array order or selection", () => {
      const priority = new ClipPriority();
      priority.move(document, 7);
      priority.move(document, 10);
      expect(priority.resolve(document, 10)).toEqual(a);
      priority.move(document, 15);
      priority.move(document, 10);
      expect(priority.resolve(document, 10)).toEqual(b);
   });
   it("remembers the deleted side instead of targeting its neighbor", () => {
      const priority = new ClipPriority();
      priority.remember(a);
      const deleted = deleteClip({ ...document, selectedId: a.id });
      expect(priority.resolve(deleted, 10)).toEqual(a);
      expect(priority.resolve(deleted, 10, false)).toEqual(b);
      expect(priority.resolve(document, 10)).toEqual(a);
      priority.move(deleted, 15);
      expect(priority.resolve(deleted, 10)).toEqual(b);
   });
   it("clears deletion memory when the user moves into a clear gap", () => {
      const priority = new ClipPriority();
      priority.remember(a);
      const deleted = { clips: [b], selectedId: b.id };
      priority.move(deleted, 7);
      expect(priority.resolve(deleted, 7)).toBeUndefined();
      expect(priority.resolve(deleted, 10)).toEqual(b);
   });
   it("does not let playback resolution change the last user interaction", () => {
      const priority = new ClipPriority();
      priority.remember(a);
      expect(priority.resolve(document, 15)).toEqual(b);
      expect(priority.resolve(document, 10)).toEqual(a);
      expect(priority.resolve(document, 25)).toBeUndefined();
   });
   it("allows explicit add on either exposed edge, but never between touching clips", () => {
      expect(gapAt(document, 5, 30)).toEqual({ start: 0, end: 5 });
      expect(gapAt(document, 20, 30)).toEqual({ start: 20, end: 30 });
      expect(gapAt(document, 10, 30)).toBeNull();
      expect(gapAt(document, 15, 30)).toBeNull();
   });
});
