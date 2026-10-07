import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceSession } from "./source-session.ts";
import { packetsAround, probeSource, sourceFrames } from "./media/probe.ts";
import { preparePreview } from "./media/preview.ts";
import { extractScrubPcm } from "./media/scrub-audio.ts";
import { extractWaveform } from "./media/waveform.ts";
import type { ProbedSource } from "./media/probe.ts";
vi.mock("./media/probe.ts", () => ({
   setSourceLifetime: vi.fn(),
   probeSource: vi.fn(async (path: string) => ({ id: path, path, duration: 36000, extension: ".mkv" }) as ProbedSource),
   sourceKeyframes: vi.fn(async () => [0, 2]),
   sourceFrames: vi.fn(async () => null),
   packetsAround: vi.fn(async () => []),
}));
vi.mock("./media/scrub-audio.ts", () => ({
   scrubChunkSeconds: 5,
   extractScrubPcm: vi.fn(async () => ({ start: 0, sampleRate: 22050, pcm: new ArrayBuffer(2) })),
}));
vi.mock("./media/preview.ts", () => ({ preparePreview: vi.fn(), leasePreview: vi.fn(), releasePreview: vi.fn() }));
vi.mock("./media/waveform.ts", () => ({ extractWaveform: vi.fn(async () => ({ rate: 1000, buckets: 1 })) }));
afterEach(() => vi.clearAllMocks());
describe("source lifetime", () => {
   it("remembers editor activity while the waveform job waits for capacity", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      await session.startWaveform("a", "queued", [1], undefined, () => {});
      const options = vi.mocked(extractWaveform).mock.calls.at(-1)![4];
      session.waveformActivity("queued", true);
      const listener = vi.fn();
      const unsubscribe = options.activity!(listener);
      expect(listener).toHaveBeenLastCalledWith(true);
      session.waveformActivity("old", false);
      expect(listener).toHaveBeenCalledTimes(1);
      session.waveformActivity("queued", false);
      expect(listener).toHaveBeenLastCalledWith(false);
      session.waveformRegion("queued", 4000, 4020);
      const region = vi.fn();
      const unregion = options.region!(region);
      expect(region).toHaveBeenLastCalledWith(4000, 4020);
      session.waveformRegion("old", 100, 120);
      expect(region).toHaveBeenCalledOnce();
      unregion();
      unsubscribe();
      session.dispose();
   });
   it("reuses an aligned mixed preview with delayed tracks", async () => {
      vi.mocked(probeSource).mockResolvedValueOnce({
         id: "a",
         path: "a",
         duration: 10,
         extension: ".mkv",
         streams: [
            { type: "audio", index: 2, startTime: 0 },
            { type: "audio", index: 3, startTime: 1 },
         ],
      } as ProbedSource);
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      vi.mocked(preparePreview).mockResolvedValueOnce({ id: "preview", path: "preview.mp4" });
      await session.prepare("a", [2, 3], false);
      expect(session.waveformDecodePath([2, 3])).toBe("preview.mp4");
      session.dispose();
   });
   it("waits for cancelled waveform children before shutdown", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      let reject!: (error: Error) => void;
      vi.mocked(extractWaveform).mockImplementationOnce(
         () =>
            new Promise((_resolve, fail) => {
               reject = fail;
            })
      );
      const pending = session.startWaveform("a", "wave", [1], undefined, () => {});
      const rejected = expect(pending).rejects.toThrow("Cancelled");
      session.dispose();
      let settled = false;
      const idle = session.waitForWaveformIdle().then(() => {
         settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      reject(new Error("Cancelled"));
      await rejected;
      await idle;
      expect(settled).toBe(true);
   });
   it("scopes waveform cancellation and discards chunks from replaced sources", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      const chunks = vi.fn();
      await session.startWaveform("a", "old", [1], undefined, chunks);
      const old = vi.mocked(extractWaveform).mock.calls.at(-1)!;
      await session.startWaveform("a", "new", [2], undefined, chunks);
      const current = vi.mocked(extractWaveform).mock.calls.at(-1)!;
      session.cancelWaveform("old");
      expect(current[2]!.aborted).toBe(false);
      old[3]({ offset: 0, rate: 1000, peaks: new Uint8Array(3) });
      expect(chunks).not.toHaveBeenCalled();
      await session.open("b");
      expect(current[2]!.aborted).toBe(true);
      current[3]({ offset: 0, rate: 1000, peaks: new Uint8Array(3) });
      expect(chunks).not.toHaveBeenCalled();
      session.dispose();
   });
   it("reuses a preview only for its exact audio selection and stops waveform before preparation", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      await session.startWaveform("a", "wave", [1], undefined, () => {});
      const signal = vi.mocked(extractWaveform).mock.calls.at(-1)![2]!;
      vi.mocked(preparePreview).mockResolvedValueOnce({ id: "preview", path: "preview.mp4" });
      await session.prepare("a", [5, 3], false);
      expect(signal.aborted).toBe(true);
      expect(session.waveformDecodePath([3, 5])).toBe("preview.mp4");
      expect(session.waveformDecodePath([3])).toBeUndefined();
      session.dispose();
   });
   it("preserves the current source when a project fails validation", async () => {
      const session = new SourceSession("unused-preview-directory");
      await session.open("a");
      await expect(
         session.open("b", () => {
            throw new Error("Saved clips do not match");
         })
      ).rejects.toThrow("Saved clips do not match");
      expect(session.current?.path).toBe("a");
      expect([...session.mediaPaths.keys()]).toEqual(["a"]);
      session.dispose();
   });
   it("does not adopt a source whose probe finishes after the workspace closes", async () => {
      const session = new SourceSession("unused-preview-directory");
      let finish!: (source: ProbedSource) => void;
      vi.mocked(probeSource).mockImplementationOnce(
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      const opening = session.open("pending");
      const rejected = expect(opening).rejects.toThrow();
      session.close();
      finish({ id: "pending", path: "pending", duration: 10 } as ProbedSource);
      await rejected;
      expect(session.mediaPaths.size).toBe(0);
      expect(() => session.get("pending")).toThrow();
      session.dispose();
   });
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
      await session.scrubAudio("a", [1], 4);
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
