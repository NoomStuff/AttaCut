import { expect, it } from "vitest";
import { savedSessionSchema } from "./editing";
import { clipLimit, undoLimit } from "./defaults";
import { encodeSession } from "./session-codec";
import { sessionStorageSchema } from "./session-storage";
import { ipcRequestSchemas } from "./ipc-requests";

const clip = (id: string, start: number, end: number, color = 0) => ({ id, start, end, color });
const session = savedSessionSchema.parse({
   path: "recording.mp4",
   size: 1,
   modified: 2,
   clips: [clip("a", 0.25, 5), clip("c", 6, 8, 2)],
   selectedId: "c",
   past: [
      { clips: [], selectedId: null },
      { clips: [clip("a", 0, 10)], selectedId: "a" },
      { clips: [clip("a", 0, 5), clip("b", 5, 10, 1)], selectedId: "b" },
      { clips: [clip("a", 0.25, 5), clip("b", 6, 10, 1)], selectedId: "b" },
      { clips: [clip("a", 0.25, 5)], selectedId: "a" },
   ],
   future: [
      { clips: [clip("a", 0.25, 8)], selectedId: "a" },
      { clips: [clip("a", 0.25, 8)], selectedId: null },
      { clips: [], selectedId: null },
   ],
   project: { path: "edit.attacut", savedClips: [clip("a", 0, 10)] },
});

it("preserves both history branches, clip identity, colors, selection, and the last explicitly saved edit", () => {
   const stored = encodeSession(session);
   expect(sessionStorageSchema.parse(JSON.parse(JSON.stringify(stored)))).toEqual(session);
   expect(ipcRequestSchemas["state:flush"].shape.session.parse(stored)).toEqual(session);
   expect(stored.history.past[0]).toEqual({ remove: ["c"], set: [], selectedId: "a" });
   expect(stored.history.future[1]).toEqual({ remove: [], set: [], selectedId: null });
   expect(session.past).toHaveLength(5);
});

it("migrates legacy snapshots, including missing empty history, without mutating them", () => {
   const restored = sessionStorageSchema.parse(session);
   expect(sessionStorageSchema.parse(encodeSession(restored))).toEqual(session);
   const legacy = { ...session, past: undefined, future: undefined };
   expect(sessionStorageSchema.parse(encodeSession(sessionStorageSchema.parse(legacy)))).toEqual({ ...session, past: [], future: [] });
});

it("stores only each changed clip across a full history and shares unchanged clips when opening it", () => {
   const clips = Array.from({ length: clipLimit }, (_, index) => clip(`clip-${index}`, index * 2, index * 2 + 1));
   const past = Array.from({ length: undoLimit }, (_, index) => ({
      clips: [{ ...clips[0]!, end: 0.5 + index / 1000 }, ...clips.slice(1)],
      selectedId: clips[0]!.id,
   }));
   const large = { ...session, clips, selectedId: clips[0]!.id, past, future: [] };
   const stored = encodeSession(large);
   expect(stored.history.past.every((delta) => delta.set.length === 1 && delta.remove.length === 0)).toBe(true);
   expect(JSON.stringify(stored).length).toBeLessThan(JSON.stringify(large).length / 50);
   const restored = sessionStorageSchema.parse(stored);
   expect(restored).toEqual(large);
   expect(restored.past[0]!.clips[1]).toBe(restored.clips[1]);
});

it("rejects malformed changes and unknown history versions rather than discarding history", () => {
   const stored = encodeSession(session);
   const delta = stored.history.past[0]!;
   const invalid = [
      { ...delta, remove: ["missing"] },
      { ...delta, remove: ["c", "c"] },
      { ...delta, set: [clip("c", 6, 8), clip("c", 6, 8)] },
      { ...delta, set: [clip("c", 6, 8)] },
      { ...delta, set: [clip("a", 0, 7), clip("d", 6, 8)] },
      { ...delta, set: [clip("a", 5, 4)] },
      { ...delta, selectedId: "missing" },
   ];
   for (const change of invalid) expect(sessionStorageSchema.safeParse({ ...stored, history: { ...stored.history, past: [change] } }).success).toBe(false);
   expect(sessionStorageSchema.safeParse({ ...stored, history: { ...stored.history, version: 99 } }).success).toBe(false);
   expect(sessionStorageSchema.safeParse({ ...stored, history: { ...stored.history, past: Array(undoLimit + 1).fill(delta) } }).success).toBe(false);
   const full = encodeSession({
      ...session,
      clips: Array.from({ length: clipLimit }, (_, index) => clip(`clip-${index}`, index * 2, index * 2 + 1)),
      selectedId: null,
      past: [],
      future: [],
   });
   expect(
      sessionStorageSchema.safeParse({
         ...full,
         history: { version: 1, future: [], past: [{ remove: [], set: [clip("extra", clipLimit * 2, clipLimit * 2 + 1)], selectedId: null }] },
      }).success
   ).toBe(false);
});
