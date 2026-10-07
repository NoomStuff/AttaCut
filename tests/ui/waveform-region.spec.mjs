import { test, waitForVideo } from "./app.mjs";
import { expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hasWaveformPixels } from "./waveform-pixels.mjs";

test("a distant edit receives useful waveform data before the sequential scan reaches it", async ({ launchApp, profile }, testInfo) => {
   test.skip(!process.env.ATTACUT_PERFORMANCE_VIDEO, "Opt-in recording region benchmark");
   test.setTimeout(90000);
   await writeFile(
      join(profile, "settings.json"),
      JSON.stringify({ version: 1, preferences: { waveform: true, audioScrub: false, updateCheck: false }, session: null })
   );
   const app = await launchApp(profile, resolve(process.env.ATTACUT_PERFORMANCE_VIDEO));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.evaluate(() => {
      globalThis.regionRun = { start: globalThis.performance.now(), first: 0, complete: 0, priorityEnd: 0, prefixEnd: 0, chunks: [] };
      globalThis.desktop.onWaveformChunk((chunk) => {
         const s = globalThis.regionRun;
         const from = chunk.offset / chunk.rate;
         const to = (chunk.offset + chunk.peaks.length / 3) / chunk.rate;
         s.chunks.push({ from, to, priority: !!chunk.priority, ms: globalThis.performance.now() - s.start });
         // Frame alignment may move the pointer target by one 60 fps frame.
         if (chunk.priority && from >= 3484.95) {
            s.first ||= globalThis.performance.now() - s.start;
            s.priorityEnd = Math.max(s.priorityEnd, to);
            if (to >= 3514.95) s.complete ||= globalThis.performance.now() - s.start;
         } else if (!chunk.priority) s.prefixEnd = to;
      });
      const bar = document.querySelector(".timeline-viewport");
      const bounds = bar.getBoundingClientRect();
      for (const type of ["pointerdown", "pointerup"])
         bar.dispatchEvent(
            new globalThis.PointerEvent(type, {
               bubbles: true,
               pointerId: 1,
               pointerType: "mouse",
               button: 0,
               buttons: type === "pointerdown" ? 1 : 0,
               clientX: bounds.x + (bounds.width * 3500) / document.querySelector("video").duration,
               clientY: bounds.y + 36,
            })
         );
   });
   await page
      .waitForFunction(() => globalThis.regionRun.complete > 0, undefined, { timeout: 30000 })
      .catch(async (error) => {
         await writeFile(testInfo.outputPath("waveform-region-stalled.json"), JSON.stringify(await page.evaluate(() => globalThis.regionRun), null, 2));
         throw error;
      });
   await page.waitForTimeout(350);
   const result = await page.evaluate(() => globalThis.regionRun);
   expect(result.prefixEnd).toBeLessThan(3485);
   expect(result.first).toBeLessThan(15000);
   await writeFile(testInfo.outputPath("waveform-region.json"), JSON.stringify(result, null, 2));
   for (let zoom = 0; zoom < 21; zoom++) await page.keyboard.press("=");
   await page.waitForTimeout(750);
   await expect.poll(() => hasWaveformPixels(page)).toBe(true);
   await page.screenshot({ path: testInfo.outputPath("waveform-region.png") });
   console.log(JSON.stringify({ firstMs: result.first, completeMs: result.complete, prefixSeconds: result.prefixEnd }));
   await app.close();
});
