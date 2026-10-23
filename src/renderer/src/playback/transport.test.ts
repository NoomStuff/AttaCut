import { expect, it, vi } from "vitest";
import type { MediaSource } from "../../../shared/types";
import { PlaybackController } from "./controller";
import { connectPlayback } from "./transport";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
function setup() {
   const playback = new PlaybackController();
   playback.source({ id: "source", url: "source" } as MediaSource);
   const video = Object.assign(new EventTarget(), { readyState: 0, currentSrc: "source", play: vi.fn(async () => {}) });
   const failure = vi.fn();
   const disconnect = connectPlayback(video as unknown as HTMLVideoElement, playback, failure);
   return { playback, video, failure, disconnect };
}

it("starts a play request after metadata, and reports actual decoder failures", async () => {
   const { playback, video, failure, disconnect } = setup();
   try {
      playback.request(true);
      await flush();
      expect(video.play).not.toHaveBeenCalled();
      video.play.mockRejectedValueOnce(new DOMException("Bad media", "NotSupportedError"));
      video.readyState = 1;
      video.dispatchEvent(new Event("loadedmetadata"));
      await flush();
      expect(video.play).toHaveBeenCalledOnce();
      expect(failure).toHaveBeenCalledOnce();
   } finally {
      disconnect();
   }
});

it("waits through preparation even when the preview reuses an already loaded URL", async () => {
   const { playback, video, disconnect } = setup();
   try {
      video.readyState = 2;
      let finish!: (url: string) => void;
      playback.request(true);
      const preparing = playback.prepare(
         "source",
         false,
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      await flush();
      expect(video.play).not.toHaveBeenCalled();
      // A stale playing event from the old media cannot consume this request.
      playback.playing();
      expect(playback.get().intent).toBe("requested");
      finish("source");
      await preparing;
      await flush();
      expect(video.play).toHaveBeenCalledOnce();
   } finally {
      disconnect();
   }
});

it("ignores aborted play and failures from a cancelled or replaced request", async () => {
   for (const cancel of ["abort", "pause", "replace"] as const) {
      const { playback, video, failure, disconnect } = setup();
      try {
         let reject!: (error: Error) => void;
         video.readyState = 2;
         video.play.mockImplementationOnce(
            () =>
               new Promise((_resolve, fail) => {
                  reject = fail;
               })
         );
         playback.request(true);
         await flush();
         if (cancel === "pause") playback.pause();
         if (cancel === "replace") playback.source({ id: "next", url: "next" } as MediaSource);
         reject(new DOMException("Cancelled", cancel === "abort" ? "AbortError" : "NotSupportedError"));
         await flush();
         expect(failure).not.toHaveBeenCalled();
      } finally {
         disconnect();
      }
   }
});

it("starts the replacement request after an earlier play attempt settles", async () => {
   const { playback, video, disconnect } = setup();
   try {
      let finish!: () => void;
      video.readyState = 2;
      video.play.mockImplementationOnce(
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      playback.request(true);
      await flush();
      playback.pause();
      playback.request(true);
      await flush();
      expect(video.play).toHaveBeenCalledOnce();
      finish();
      await flush();
      expect(video.play).toHaveBeenCalledTimes(2);
   } finally {
      disconnect();
   }
});
