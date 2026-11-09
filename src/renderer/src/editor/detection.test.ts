import { describe, expect, it } from "vitest";
import { clipLimit } from "../../../shared/defaults";
import { chapterSplitTimes, editorReducer, emptyEditor, rangesInClips, removeRanges, splitAtSceneCuts, type EditDocument } from "./model";
import { clipTimesCsv, youtubeChapters, youtubeTime } from "./clipTimes";

const document: EditDocument = {
   clips: [
      { id: "a", start: 0, end: 4, color: 0 },
      { id: "b", start: 6, end: 10, color: 1 },
   ],
   selectedId: "b",
};
const bounds = (value: EditDocument) => value.clips.map(({ start, end }) => [start, end]);

describe("removing detected ranges", () => {
   it("trims edges, splits a clip around an inner range and keeps identities", () => {
      const next = removeRanges(document, [
         { start: 7, end: 8 },
         { start: 3, end: 6.5 },
      ]);
      expect(bounds(next)).toEqual([
         [0, 3],
         [6.5, 7],
         [8, 10],
      ]);
      expect(next.clips[0]!.id).toBe("a");
      expect(next.clips[1]!.id).toBe("b");
      expect(next.clips[2]!.id).not.toBe("b");
      expect(next.clips[2]!.color).not.toBe(next.clips[1]!.color);
      expect(new Set(next.clips.map((clip) => clip.id)).size).toBe(3);
      expect(next.selectedId).toBe("b");
   });
   it("merges overlapping ranges and ignores invalid ones", () => {
      const next = removeRanges(document, [
         { start: 1, end: 2 },
         { start: 1.5, end: 2.5 },
         { start: 5, end: 4 },
         { start: NaN, end: 3 },
         { start: 4.5, end: 5.5 },
      ]);
      expect(bounds(next)).toEqual([
         [0, 1],
         [2.5, 4],
         [6, 10],
      ]);
      expect(removeRanges(document, [{ start: 4.5, end: 5.5 }])).toBe(document);
      expect(removeRanges(document, [])).toBe(document);
   });
   it("drops clips that become empty or shorter than one frame and moves a removed selection forward", () => {
      const next = removeRanges(
         document,
         [
            { start: 0, end: 3.99 },
            { start: 6, end: 10 },
         ],
         0.04
      );
      expect(bounds(next)).toEqual([]);
      expect(next.selectedId).toBeNull();
      const kept = removeRanges(document, [{ start: 5, end: 9.98 }], 0.04);
      expect(bounds(kept)).toEqual([[0, 4]]);
      expect(kept.selectedId).toBe("a");
      // Exactly one frame survives.
      expect(bounds(removeRanges(document, [{ start: 6, end: 9.96 }], 0.04))).toEqual([
         [0, 4],
         [9.96, 10],
      ]);
   });
   it("undoes as one edit", () => {
      const next = removeRanges(document, [{ start: 7, end: 8 }]);
      const edited = editorReducer({ ...emptyEditor, document }, { type: "commit", document: next });
      expect(editorReducer(edited, { type: "undo" }).document).toBe(document);
   });
   it("refuses a result over the clip limit", () => {
      const long: EditDocument = { clips: [{ id: "x", start: 0, end: clipLimit * 2, color: 0 }], selectedId: "x" };
      const ranges = Array.from({ length: clipLimit }, (_, i) => ({ start: i * 2 + 1, end: i * 2 + 1.5 }));
      expect(() => removeRanges(long, ranges)).toThrow("exceed");
   });
   it("lists only ranges that touch kept footage", () => {
      const ranges = [
         { start: 4, end: 6 },
         { start: 3.9995, end: 6.0005 },
         { start: 3, end: 5 },
         { start: 10, end: 12 },
      ];
      expect(rangesInClips(document.clips, ranges)).toEqual([{ start: 3, end: 5 }]);
   });
});

describe("chapters", () => {
   it("splits at chapter starts inside the source, once each", () => {
      const chapters = [
         { start: 0, end: 5, title: "Intro" },
         { start: 8, end: 9, title: "B" },
         { start: 5, end: 8, title: "A" },
         { start: 8, end: 9, title: "Duplicate" },
         { start: 10, end: 12, title: "Past the end" },
      ];
      const times = chapterSplitTimes(chapters, 10);
      expect(times).toEqual([5, 8]);
      expect(bounds(splitAtSceneCuts(document, times))).toEqual([
         [0, 4],
         [6, 8],
         [8, 10],
      ]);
      expect(chapterSplitTimes([{ start: 0 }], 10)).toEqual([]);
   });
});

describe("copied clip times", () => {
   const clips = [
      { id: "a", start: 0, end: 75.5, color: 0 },
      { id: "b", start: 80, end: 3700.25, color: 1 },
      { id: "c", start: 3725.123456, end: 3800, color: 2 },
   ];
   it("formats whole seconds the way YouTube reads them", () => {
      expect(youtubeTime(0)).toBe("0:00");
      expect(youtubeTime(59.999)).toBe("0:59");
      expect(youtubeTime(605)).toBe("10:05");
      expect(youtubeTime(3725.9)).toBe("1:02:05");
   });
   it("uses source times when the first clip starts at zero", () => {
      const chapters = youtubeChapters(clips, 3900);
      expect(chapters).toEqual({ text: "0:00 Clip 1\n1:20 Clip 2\n1:02:05 Clip 3\n", combined: false, usable: true });
   });
   it("uses offsets in the combined export when the first clip starts later", () => {
      const later = [
         { id: "a", start: 12, end: 30, color: 0 },
         { id: "b", start: 40, end: 52.5, color: 1 },
         { id: "c", start: 60, end: 61, color: 2 },
      ];
      expect(youtubeChapters(later, 100)).toEqual({ text: "0:00 Clip 1\n0:18 Clip 2\n0:30 Clip 3\n", combined: true, usable: false });
      expect(youtubeChapters(later.slice(0, 2), 100).usable).toBe(false);
   });
   it("writes CSV with a header and millisecond precision", () => {
      expect(clipTimesCsv(clips)).toBe("start,end,duration\n0.000,75.500,75.500\n80.000,3700.250,3620.250\n3725.123,3800.000,74.877\n");
      expect(clipTimesCsv([])).toBe("start,end,duration\n");
   });
});
