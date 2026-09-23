import { describe, expect, it } from "vitest";
import { defaultPreferences, preferencesSchema, savedSessionSchema } from "./types";

const clip = (id: string, start: number, end: number) => ({ id, start, end, color: 0 });
const session = {
   path: "C:\\video.mp4",
   size: 1,
   modified: 2,
   clips: [clip("a", 0, 10), clip("b", 10, 20)],
   selectedId: "b",
   past: [{ clips: [clip("a", 0, 20)], selectedId: "a" }],
   future: [{ clips: [clip("a", 0, 5)], selectedId: "a" }],
};

describe("saved sessions", () => {
   it("round-trips through JSON with undo history", () => {
      const parsed = savedSessionSchema.parse(JSON.parse(JSON.stringify(session)));
      expect(parsed.past).toEqual(session.past);
      expect(parsed.future).toEqual(session.future);
   });
   it("fills missing undo history and rejects inconsistent clips in it", () => {
      expect(savedSessionSchema.parse({ ...session, past: undefined }).past).toEqual([]);
      expect(() => savedSessionSchema.parse({ ...session, past: [{ clips: [clip("b", 10, 20), clip("a", 0, 10)], selectedId: null }] })).toThrow();
   });
});

it("renderer defaults match persisted preference defaults", () => {
   expect(defaultPreferences).toEqual(preferencesSchema.parse({}));
});
