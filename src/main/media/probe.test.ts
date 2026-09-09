import { describe, expect, it } from "vitest";
import { streamTitle } from "./probe.ts";
describe("Audio track names", () => {
   it("prefers titles and accepts case-insensitive MP4 handler names", () => {
      expect(streamTitle({ TITLE: " Commentary ", handler_name: "Audio" })).toBe("Commentary");
      expect(streamTitle({ HANDLER_NAME: "Microphone" })).toBe("Microphone");
      expect(streamTitle({ name: "Game audio" })).toBe("Game audio");
   });
   it("keeps unnamed tracks available for numbered labels", () => {
      expect(streamTitle({ handler_name: "SoundHandler" })).toBe("");
      expect(streamTitle()).toBe("");
   });
});
