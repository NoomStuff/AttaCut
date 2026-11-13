import { describe, expect, it } from "vitest";
import {
   applyNamePattern,
   duplicateNames,
   filenameError,
   filenameWarning,
   hasNameToken,
   nameTokens,
   normalizeFilename,
   outputFilename,
   patternTime,
   sanitizeName,
} from "./filename";

describe("filenameError", () => {
   it.each(["clip: test", "a/b", "a\\b", "a?b", "a*b", 'a"b', "a<b", "a>b", "a|b", "CON", "nul.txt", " COM¹. ", "..", "  ", ""])(
      "rejects an unusable name without rewriting it: %j",
      (name) => {
         expect(filenameError(name, ".mp4")).not.toBeNull();
      }
   );
   it("accepts names whose only problems are invisible", () => {
      for (const name of ["clip.", "clip ", " clip", "clip. . ", "a\u0000b", "a\tb", "twinkrin2-01 (Trim) "]) expect(filenameError(name, ".mp4")).toBeNull();
   });
   it("measures the complete filename in bytes as well as UTF-16 units", () => {
      expect(filenameError("a".repeat(251), ".mp4")).toBeNull();
      expect(filenameError(`${"a".repeat(251)}.MP4`, ".mp4")).toBeNull();
      expect(filenameError("a".repeat(252), ".mp4")).toMatch(/too long/);
      expect(filenameError("猫".repeat(84), ".mp4")).toMatch(/too long/);
      expect(filenameError("Summer's clip (2) 猫", ".mkv")).toBeNull();
   });
});

describe("normalizeFilename", () => {
   it("drops edge whitespace and trailing dots, and turns control characters into spaces", () => {
      expect(normalizeFilename("  my clip (Trim) ")).toBe("my clip (Trim)");
      expect(normalizeFilename("clip. . .")).toBe("clip");
      expect(normalizeFilename("a\tb\u0000")).toBe("a b");
      expect(normalizeFilename("a: b?")).toBe("a: b?");
   });
   it("writes the normalized name with the extension added once", () => {
      expect(outputFilename("clip ", ".mp4")).toBe("clip.mp4");
      expect(outputFilename("clip.MP4.", ".mp4")).toBe("clip.MP4");
   });
});

describe("filenameWarning", () => {
   it("warns about hidden names without blocking them", () => {
      expect(filenameWarning(" .clip")).toMatch(/hidden/);
      expect(filenameError(".clip", ".mp4")).toBeNull();
      expect(filenameWarning("clip")).toBeNull();
   });
});

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

   it("leaves unknown braces and typed characters for the user to see", () => {
      expect(applyNamePattern("{source} {clip}", context)).toBe("recording {clip}");
      expect(applyNamePattern("{source}: {n} ", context)).toBe("recording: 2");
   });

   it("sanitizes the source name, which the user did not type", () => {
      expect(applyNamePattern("{source} ({n})", { ...context, source: "game: round?" })).toBe("game_ round_ (2)");
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

   it("compares names as they are written to disk", () => {
      expect(duplicateNames(["my: clip", "my_ clip"])).toEqual(new Set());
      expect(duplicateNames(["a", "a ", "a."])).toEqual(new Set(["a"]));
   });
});
