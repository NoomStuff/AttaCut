import { describe, expect, it } from "vitest";
import { containerChoices, containerFamily, containerRejects, exportExtensionFor, subtitleCodecFor, turnedRotation } from "./export-format";
import type { MediaStream } from "./media";

const stream = (type: string, codec: string, extra: Partial<MediaStream> = {}): MediaStream =>
   ({ index: 0, type, codec, attachedPicture: false, ...extra }) as MediaStream;

describe("export containers", () => {
   it("offers only containers that can hold the picture", () => {
      expect(containerChoices({ streams: [stream("video", "h264")] })).toEqual([".mp4", ".mov", ".mkv"]);
      expect(containerChoices({ streams: [stream("video", "vp9")] })).toEqual([".mp4", ".mkv", ".webm"]);
      expect(containerChoices({ streams: [stream("video", "prores")] })).toEqual([".mov", ".mkv"]);
      expect(containerChoices({ streams: [stream("video", "png", { attachedPicture: true }), stream("video", "vp8", { index: 1 })] })).toEqual([
         ".mkv",
         ".webm",
      ]);
   });
   it("names the stream a container cannot store instead of dropping it", () => {
      expect(containerRejects(".mp4", stream("audio", "pcm_s16le"))).toMatch(/MP4 cannot store PCM audio/);
      expect(containerRejects(".mov", stream("audio", "pcm_s24le"))).toBeNull();
      expect(containerRejects(".webm", stream("audio", "aac"))).toMatch(/WebM cannot store AAC/);
      expect(containerRejects(".mp4", stream("subtitle", "hdmv_pgs_subtitle"))).toMatch(/picture subtitles/);
      expect(containerRejects(".mp4", stream("subtitle", "subrip"))).toBeNull();
      expect(containerRejects(".mp4", stream("attachment", "ttf"))).toMatch(/attachments/);
      expect(containerRejects(".mkv", stream("attachment", "ttf"))).toBeNull();
      expect(containerRejects(".mp4", stream("data", "bin_data"))).toBeNull();
   });
   it("rewrites text subtitles into the container's own format", () => {
      expect(subtitleCodecFor(".m4v", "subrip")).toBe("mov_text");
      expect(subtitleCodecFor(".webm", "ass")).toBe("webvtt");
      expect(subtitleCodecFor(".mkv", "mov_text")).toBe("subrip");
      expect(subtitleCodecFor(".mkv", "ass")).toBe("ass");
      expect(containerFamily(".TS")).toBe(".mkv");
   });
   it("uses a picked container even for an unchanged full-length clip", () => {
      const source = { extension: ".ts", exportExtension: ".mkv", duration: 10 };
      const full = { start: 0, end: 10 };
      expect(exportExtensionFor(source, full, { separate: true, unchanged: true })).toBe(".ts");
      expect(exportExtensionFor(source, full, { separate: true, unchanged: false })).toBe(".mkv");
      expect(exportExtensionFor(source, full, { separate: true, unchanged: true, container: ".mp4" })).toBe(".mp4");
      expect(exportExtensionFor(source, { start: 1, end: 4 }, { separate: false, unchanged: true, container: "auto" })).toBe(".mkv");
   });
   it("turns the display rotation clockwise in ffmpeg's counterclockwise degrees", () => {
      expect(turnedRotation(0, 90)).toBe(-90);
      expect(turnedRotation(-90, 90)).toBe(180);
      expect(turnedRotation(90, 90)).toBe(0);
      expect(turnedRotation(0, 270)).toBe(90);
      expect(turnedRotation(180, 180)).toBe(0);
   });
});
