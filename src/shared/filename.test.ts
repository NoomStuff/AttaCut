import { describe, expect, it } from "vitest";
import { applyNamePattern, duplicateNames, hasNameToken, nameTokens, patternTime, sanitizeName } from "./filename";

describe("sanitizeName", () => {
   it("replaces forbidden characters and reserved device names", () => {
      expect(sanitizeName("clip: one/two?")).toBe("clip_ one_two_");
      expect(sanitizeName("con")).toMatch(/^clip-con/);
      expect(sanitizeName("  ")).toMatch(/^clip-untitled/);
   });
});

describe("patternTime", () => {
   it("omits the hour under one and pads every field", () => {
      expect(patternTime(0)).toBe("00-00.000");
      expect(patternTime(2.4)).toBe("00-02.400");
      expect(patternTime(155.25)).toBe("02-35.250");
      expect(patternTime(3723.5)).toBe("1-02-03.500");
   });

   it("carries rounded thousandths into the seconds", () => {
      expect(patternTime(1.9999)).toBe("00-02.000");
   });
});

describe("applyNamePattern", () => {
   const context = { source: "recording", index: 1, count: 12, start: 83.25, end: 95.5, total: 325.75, date: new Date("2026-10-03T12:00:00") };
   it("expands every token", () => {
      expect(applyNamePattern("{source} ({n})", context)).toBe("recording (2)");
      expect(applyNamePattern("{source} ({n})", { ...context, index: 8 })).toBe("recording (9)");
      expect(applyNamePattern("{source} ({n} of {count})", context)).toBe("recording (2 of 12)");
      expect(applyNamePattern("{source} {start}-{end}", context)).toBe("recording 01-23.250-01-35.500");
      expect(applyNamePattern("{source} ({duration})", context)).toBe("recording (00-12.250)");
      expect(applyNamePattern("{source} ({total})", context)).toBe("recording (05-25.750)");
      expect(applyNamePattern("{source} ({date})", context)).toBe("recording (2026-10-03)");
   });

   it("leaves unknown braces for the user to see and sanitizes the result", () => {
      expect(applyNamePattern("{source} {clip}", context)).toBe("recording {clip}");
      expect(applyNamePattern("{source}: {n}", context)).toBe("recording_ 2");
   });

   it("documents every token the pattern understands", () => {
      for (const token of nameTokens) expect(hasNameToken(`x ${token.token} y`)).toBe(true);
      expect(hasNameToken("plain name")).toBe(false);
      expect(hasNameToken("{clip}")).toBe(false);
   });
});

describe("duplicateNames", () => {
   it("flags names that repeat, compared the way file systems do", () => {
      expect(duplicateNames(["clip (1)", "clip (2)", "clip (1)"])).toEqual(new Set(["clip (1)"]));
      expect(duplicateNames(["Clip A", "clip a"])).toEqual(new Set(["clip a"]));
      expect(duplicateNames(["one", "two"])).toEqual(new Set());
      expect(duplicateNames([])).toEqual(new Set());
   });

   it("compares sanitized names, since that is what reaches the disk", () => {
      expect(duplicateNames(["my: clip", "my_ clip"])).toEqual(new Set(["my_ clip"]));
      expect(duplicateNames(["a", "a ", "a."])).toEqual(new Set(["a"]));
   });
});
