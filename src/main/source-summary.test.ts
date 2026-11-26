import { expect, it } from "vitest";
import { describeSource } from "./source-summary";
import type { MediaStream } from "../shared/media";

const video = {
   type: "video",
   codec: "hevc",
   width: 3840,
   height: 2160,
   frameRate: 59.94,
   pixelFormat: "yuv420p10le",
   colorTransfer: "smpte2084",
   fieldOrder: "progressive",
   title: "private-title",
   attachedPicture: false,
} as MediaStream;
const audio = { type: "audio", codec: "aac", channels: 2, sampleRate: 48000, title: "Mic" } as MediaStream;

it("summarizes streams without titles and groups identical tracks", () => {
   const text = describeSource({
      extension: ".mkv",
      duration: 3723.4,
      size: 2.5 * 1024 ** 3,
      streams: [video, audio, audio, { type: "subtitle", codec: "subrip" } as MediaStream],
   });
   expect(text).toBe("mkv, 1h02m03s, 2.5 GB; video hevc 3840x2160 59.94fps yuv420p10le smpte2084; audio aac 2ch 48kHz x2; subtitle subrip");
   expect(text).not.toContain("private-title");
   expect(text).not.toContain("Mic");
});

it("handles short files without streams", () => {
   expect(describeSource({ extension: "", duration: 7.4, size: 3 * 1024 ** 2, streams: [] })).toBe("(no extension), 0m07s, 3 MB; no streams");
});
