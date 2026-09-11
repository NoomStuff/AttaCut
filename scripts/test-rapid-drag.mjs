/* global PointerEvent, performance, requestAnimationFrame, setInterval, clearInterval */
import assert from "node:assert/strict";
import { _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
const profile = await mkdtemp(resolve("work/rapid-profile-"));
const app = await electron.launch({
   args: ["."],
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
try {
   const page = await app.firstWindow();
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   await page.getByRole("slider", { name: "Clip 1 start", exact: true }).waitFor();
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   for (const side of ["scrub", "start", "end"]) {
      const selector = side === "scrub" ? ".timeline-viewport" : `.trim-handle.${side}`;
      const view = await page.locator(".timeline-viewport").boundingBox();
      const handle = await page.locator(selector).boundingBox();
      await page.mouse.move(
         side === "scrub" ? view.x + view.width * 0.2 : handle.x + handle.width / 2,
         side === "scrub" ? view.y + 8 : handle.y + handle.height / 2
      );
      await page.mouse.down();
      const samples = await page.evaluate(
         async ({ side, selector }) => {
            const target = document.querySelector(selector);
            const view = document.querySelector(".timeline-viewport").getBoundingClientRect();
            // Rapid ramps and reversals, with inputs arriving several times per rendered frame.
            const stops = side === "start" ? [0.1, 0.4, 0.2, 0.45] : side === "end" ? [0.9, 0.6, 0.85, 0.55] : [0.2, 0.8, 0.25, 0.75];
            let wanted = stops[0];
            const samples = [];
            const begin = performance.now();
            const input = setInterval(() => {
               const elapsed = performance.now() - begin;
               const leg = Math.min(2, Math.floor(elapsed / 160));
               const progress = Math.min(1, (elapsed - leg * 160) / 160);
               wanted = stops[leg] + (stops[leg + 1] - stops[leg]) * progress;
               target.dispatchEvent(
                  new PointerEvent("pointermove", {
                     bubbles: true,
                     pointerId: 1,
                     pointerType: "mouse",
                     buttons: 1,
                     clientX: view.x + wanted * view.width,
                     clientY: view.y + 30,
                  })
               );
            }, 1);
            await new Promise((done) => {
               const sample = () => {
                  const rect = document.querySelector(side === "scrub" ? ".playhead" : ".clip-range").getBoundingClientRect();
                  const pixel = side === "scrub" ? rect.x + rect.width / 2 : side === "start" ? rect.x : rect.right;
                  const ph = document.querySelector(".playhead").getBoundingClientRect();
                  samples.push({
                     ms: performance.now() - begin,
                     wanted,
                     drawn: (pixel - view.x) / view.width,
                     alignment: side === "scrub" ? 0 : Math.abs(pixel - ph.x - ph.width / 2),
                  });
                  if (performance.now() - begin < 480) requestAnimationFrame(sample);
                  else done();
               };
               requestAnimationFrame(sample);
            });
            clearInterval(input);
            return samples;
         },
         { side, selector }
      );
      await page.mouse.up();
      // Release while still moving, then ensure the committed edge and playhead agree.
      await page.waitForTimeout(120);
      const settled = await page.evaluate((side) => {
         const view = document.querySelector(".timeline-viewport").getBoundingClientRect();
         const rect = document.querySelector(side === "scrub" ? ".playhead" : ".clip-range").getBoundingClientRect();
         const pixel = side === "scrub" ? rect.x + rect.width / 2 : side === "start" ? rect.x : rect.right;
         const ph = document.querySelector(".playhead").getBoundingClientRect();
         return { drawn: (pixel - view.x) / view.width, alignment: Math.abs(pixel - ph.x - ph.width / 2) };
      }, side);
      const moving = samples.filter((s) => s.ms > 50 && s.ms < 480);
      const lag = Math.max(...moving.map((s) => Math.abs(s.wanted - s.drawn)));
      console.log(
         `${side}: maximum lag ${(100 * lag).toFixed(1)}% of timeline, settled error ${(100 * Math.abs(samples.at(-1).wanted - settled.drawn)).toFixed(2)}%`
      );
      assert(lag < 0.12, `${side} falls behind rapid input: ${(lag * 100).toFixed(1)}%`);
      assert(Math.abs(samples.at(-1).wanted - settled.drawn) < 0.005, `${side} did not settle`);
      assert(settled.alignment < 1, `${side} detached from playhead on release`);
      assert(
         samples.every((s) => s.alignment < 1),
         `${side} detached from playhead`
      );
   }
} finally {
   await app.close();
}
