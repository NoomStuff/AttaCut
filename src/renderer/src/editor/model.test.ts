import { describe, expect, it } from "vitest";
import {
   clipAt,
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
