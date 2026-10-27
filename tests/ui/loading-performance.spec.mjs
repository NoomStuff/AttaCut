import { expect } from "@playwright/test";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { test, waitForVideo } from "./app.mjs";

// Keep the input and OS file cache constant. Each test starts with fresh app caches.
// Report timings instead of asserting a hardware-dependent millisecond threshold.
test("measure source opening through a decoded frame and editable timeline", async ({ launchApp, profile }, testInfo) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
   const path = resolve(process.env.ATTACUT_PERFORMANCE_VIDEO ?? "work/fixture.mp4");
   const measurements = [];
   for (let run = 0; run < 6; run++) {
      const previousUrl = await page.evaluate(() => document.querySelector("video")?.getAttribute("src") ?? null);
      await page.evaluate(() => {
         globalThis.openingTiming = { started: globalThis.performance.now(), decodedMs: null };
         document.addEventListener(
            "loadeddata",
            () => {
               globalThis.openingTiming.decodedMs = globalThis.performance.now() - globalThis.openingTiming.started;
            },
            { capture: true, once: true }
         );
      });
      const started = performance.now();
      await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
      await expect(page.locator(".player-stage video")).toHaveAttribute("src", /media:\/\/source\//);
      await expect.poll(() => page.locator(".player-stage video").getAttribute("src")).not.toBe(previousUrl);
      await waitForVideo(page);
      await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Clip start", exact: true })).toBeEditable();
      measurements.push({
         run,
         cache: run === 0 ? "cold" : "warm",
         readyMs: performance.now() - started,
         decodedMs: await page.evaluate(() => globalThis.openingTiming.decodedMs),
      });
   }
   await testInfo.attach("source-opening-times", {
      body: JSON.stringify({ path, measurements }, null, 2),
      contentType: "application/json",
   });
});

test("measure startup with a recording passed by the launcher", async ({ launchApp, profile }, testInfo) => {
   const started = performance.now();
   const app = await launchApp(profile, resolve(process.env.ATTACUT_PERFORMANCE_VIDEO ?? "work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await expect(page.getByRole("textbox", { name: "Clip start", exact: true })).toBeEditable();
   await testInfo.attach("startup-opening-time", {
      body: JSON.stringify({ readyMs: performance.now() - started }),
      contentType: "application/json",
   });
});
