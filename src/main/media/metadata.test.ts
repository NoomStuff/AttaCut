import { describe, expect, it } from "vitest";
import { isDynamicHdrMetadata } from "./probe";
import { trimAss } from "./metadata";

describe("metadata preservation", () => {
   it("recognizes FFmpeg's dynamic HDR frame and packet names", () => {
      for (const name of [
         "HDR Dynamic Metadata SMPTE2094-40 (HDR10+)",
         "HDR10+ Dynamic Metadata (SMPTE 2094-40)",
         "HDR Dynamic Metadata CUVA 005.1 2021 (Vivid)",
         "Dolby Vision RPU Data",
         "DOVI configuration record",
      ]) {
         expect(isDynamicHdrMetadata(name), name).toBe(true);
      }
      expect(isDynamicHdrMetadata("Mastering display metadata")).toBe(false);
      expect(isDynamicHdrMetadata("Content light level metadata")).toBe(false);
   });
   it("clips captions at both boundaries without damaging styles or commas in text", () => {
      const text =
         "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello, world\nDialogue: 0,0:00:04.50,0:00:06.00,Default,,0,0,0,,{\\i1}End\nDialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,Excluded";
      const trimmed = trimAss(text, 2, 5);
      expect(trimmed).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0,0,0,,Hello, world");
      expect(trimmed).toContain("Dialogue: 0,0:00:02.50,0:00:03.00,Default,,0,0,0,,{\\i1}End");
      expect(trimmed).not.toContain("Excluded");
      expect(trimmed).toContain("[Events]\nFormat:");
   });
});
