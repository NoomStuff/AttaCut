import { describe, expect, it } from "vitest";
import { PlaybackController } from "./controller";
import type { MediaSource } from "../../../shared/types";
const source = (id: string) => ({ id, url: id }) as MediaSource;
describe("preview lifecycle", () => {
   it("ignores an old preview after another source opens", async () => {
      const controller = new PlaybackController();
      controller.source(source("a"));
      let finish!: (url: string) => void;
      const pending = controller.prepare(
         "a",
         false,
         () =>
            new Promise((resolve) => {
               finish = resolve;
            })
      );
      controller.source(source("b"));
      finish("old-preview");
      await pending;
      expect(controller.get()).toMatchObject({ sourceId: "b", url: "b", phase: "source", intent: "paused" });
   });
   it("preserves a cancelled play request when a preview finishes", async () => {
      const controller = new PlaybackController();
      controller.source(source("a"));
      controller.request(true);
      const pending = controller.prepare("a", true, async () => "preview");
      controller.pause();
      await pending;
      expect(controller.get()).toMatchObject({ phase: "preview", intent: "paused", showWait: false });
   });
});
