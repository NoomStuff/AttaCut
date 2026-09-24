import { expect, it } from "vitest";
import { clipChanges } from "./clipChanges";
import { addGap, deleteClip, newDocument, splitClip, trimClip } from "./model";

it("uses split and merge feedback through undo/redo without add/delete effects", () => {
   const original = newDocument(20);
   const split = splitClip(original, original.selectedId!, 10);
   const forward = clipChanges(original.clips, split.clips);
   expect(forward.entering).toEqual([]);
   expect(forward.exiting).toEqual([]);
   expect([...forward.flashes.values()]).toEqual([["end"], ["start"]]);
   const undo = clipChanges(split.clips, original.clips);
   expect(undo.seams.map((seam) => seam.time)).toEqual([10]);
   expect(undo.entering).toEqual([]);
   expect(undo.exiting).toEqual([]);
   expect([...undo.flashes]).toEqual([[original.selectedId, []]]);
   expect(clipChanges(original.clips, split.clips)).toEqual(forward);
});

it("animates genuine additions/removals and leaves boundary edits alone", () => {
   const original = newDocument(20);
   const trimmed = trimClip(original, original.selectedId!, "start", 5, 20);
   expect(clipChanges(original.clips, trimmed.clips)).toEqual({ entering: [], exiting: [], flashes: new Map(), seams: [] });
   expect(clipChanges(trimmed.clips, original.clips)).toEqual({ entering: [], exiting: [], flashes: new Map(), seams: [] });
   const added = addGap(trimmed, 2, 20);
   expect(clipChanges(trimmed.clips, added.clips).entering).toEqual([added.selectedId]);
   const deleted = deleteClip(added, added.selectedId!);
   expect(clipChanges(added.clips, deleted.clips).exiting.map(({ clip }) => clip.id)).toEqual([added.selectedId]);
});
