import { expect, it } from "vitest";
import { scheduleMedia } from "./scheduler";

it("reserves seek capacity and removes cancelled queued work", async () => {
   const started: string[] = [];
   const finish = new Map<string, () => void>();
   const task = (name: string) => () =>
      new Promise<void>((resolve) => {
         started.push(name);
         finish.set(name, resolve);
      });
   const first = scheduleMedia(task("export"), "export");
   const second = scheduleMedia(task("preview"), "background");
   const third = scheduleMedia(task("index"), "background");
   const seek = scheduleMedia(task("seek"));
   expect(started).toEqual(["export", "preview", "seek"]);
   const controller = new AbortController();
   const cancelled = scheduleMedia(task("cancelled"), "interactive", controller.signal);
   controller.abort();
   await expect(cancelled).rejects.toThrow("Cancelled");
   finish.get("export")!();
   await first;
   expect(started).toEqual(["export", "preview", "seek", "index"]);
   for (const name of ["preview", "seek", "index"]) finish.get(name)!();
   await Promise.all([second, third, seek]);
});
