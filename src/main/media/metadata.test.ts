import { isDynamicHdrMetadata } from "./probe";
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { metadataInputs, trimAss } from "./metadata";
import { runMedia } from "./process";
import type { ProbedSource } from "./probe";

vi.mock("./process", () => ({ runMedia: vi.fn(async () => "[Events]\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Caption") }));

it("reuses source captions across clips without losing the selected audio mapping", async () => {
   const directory = await mkdtemp(join(tmpdir(), "attacut-captions-"));
   const source = {
      path: "recording.mkv",
      chapters: [],
      streams: [
         { type: "audio", index: 1, disposition: {} },
         { type: "audio", index: 2, disposition: {} },
         { type: "subtitle", index: 3, codec: "ass", language: "eng", title: "Captions", disposition: {} },
      ],
   } as unknown as ProbedSource;
   try {
      await metadataInputs(source, { id: "a", start: 0, end: 1, color: 0 }, directory, "first.mkv", undefined, [1]);
      const second = await metadataInputs(source, { id: "b", start: 2, end: 3, color: 1 }, directory, "second.mkv", undefined, [2]);
      expect(runMedia).toHaveBeenCalledTimes(1);
      expect(second.outputs).toContain("1:s:2");
      expect(second.outputs).not.toContain("1:s:1");
      expect(await readFile(join(directory, "subtitles-0.ass"), "utf8")).toContain("0:00:00.00,0:00:01.00");
   } finally {
      await rm(directory, { recursive: true, force: true });
   }
});

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
