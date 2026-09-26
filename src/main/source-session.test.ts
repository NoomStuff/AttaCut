import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceSession } from "./source-session.ts";
import { packetsAround, probeSource, sourceFrames } from "./media/probe.ts";
import { preparePreview } from "./media/preview.ts";
import { extractScrubPcm } from "./media/scrub-audio.ts";
import type { ProbedSource } from "./media/probe.ts";
vi.mock("./media/probe.ts", () => ({
   probeSource: vi.fn(async (path: string) => ({ id: path, path, duration: 36000 }) as ProbedSource),
   sourceKeyframes: vi.fn(async () => [0, 2]),
   sourceFrames: vi.fn(async () => null),
   packetsAround: vi.fn(async () => []),
}));
vi.mock("./media/scrub-audio.ts", () => ({
   scrubChunkSeconds: 30,
   extractScrubPcm: vi.fn(async () => ({ start: 0, sampleRate: 22050, pcm: new ArrayBuffer(2) })),
}));
vi.mock("./media/preview.ts", () => ({ preparePreview: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe("source lifetime", () => {
   it("keeps a replacement audio request when a cancelled request for the same chunk rejects", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      let rejectOld!: (error: Error) => void;
      vi.mocked(extractScrubPcm).mockImplementationOnce(
         () =>
            new Promise((_resolve, reject) => {
               rejectOld = reject;
            })
      );
      const old = session.scrubAudio("a", [1], 0);
      const rejected = expect(old).rejects.toThrow("Cancelled");
      session.cancelScrub();
      const current = session.scrubAudio("a", [1], 0);
      rejectOld(new Error("Cancelled"));
      await rejected;
      expect(session.scrubAudio("a", [1], 0)).toBe(current);
      await current;
      session.dispose();
   });
   it("releases old sources and aborts their work while preserving a failed-open source", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      const signal = session.signal;
      vi.mocked(probeSource).mockRejectedValueOnce(new Error("unreadable"));
      await expect(session.open("bad")).rejects.toThrow("unreadable");
      expect(session.get("a").id).toBe("a");
      await session.open("b");
      expect(signal.aborted).toBe(true);
      expect(() => session.get("a")).toThrow();
      expect([...session.mediaPaths.keys()]).toEqual(["b"]);
      session.dispose();
   });
   it("reuses one audio chunk and cancels it when tracks or chunk change", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      await session.scrubAudio("a", [1], 0);
      await session.scrubAudio("a", [1], 20);
      expect(extractScrubPcm).toHaveBeenCalledTimes(1);
      const signal = vi.mocked(extractScrubPcm).mock.calls[0]![2]!;
      await session.scrubAudio("a", [2], 60);
      expect(signal.aborted).toBe(true);
      expect(extractScrubPcm).toHaveBeenCalledTimes(2);
      expect(vi.mocked(extractScrubPcm).mock.calls[1]![3]).toBe(60);
      session.dispose();
   });
});

it("does not restart an old seek after the source changes", async () => {
   const session = new SourceSession("unused-preview-directory");
   await session.open("a");
   let finishIndex!: (value: null) => void;
   vi.mocked(sourceFrames).mockImplementationOnce(
      () =>
         new Promise((resolve) => {
            finishIndex = resolve;
         })
   );
   const pending = session.frameTime("a", 5, 1);
   const rejected = expect(pending).rejects.toThrow();
   await session.open("b");
   vi.mocked(packetsAround).mockClear();
   finishIndex(null);
   await rejected;
   expect(packetsAround).not.toHaveBeenCalled();
   session.dispose();
});

it("does not write a preview cancelled while startup cache cleanup is pending", async () => {
   let finishCleanup!: () => void;
   const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
   });
   const session = new SourceSession("unused-preview-directory", cleanup);
   await session.open("a");
   const pending = session.prepare("a", [], false);
   const rejected = expect(pending).rejects.toThrow();
   expect(preparePreview).not.toHaveBeenCalled();
   session.cancelPreview();
   finishCleanup();
   await rejected;
   expect(preparePreview).not.toHaveBeenCalled();
   session.dispose();
});
