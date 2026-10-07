import { expect } from "@playwright/test";
import { test, waitForVideo, waitForPlaybackTime } from "./app.mjs";
import { resolve, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { hasWaveformPixels } from "./waveform-pixels.mjs";

async function openWaveform(launchApp, profile) {
   await writeFile(join(profile, "settings.json"), JSON.stringify({ version: 1, preferences: { waveform: true, keepPlaying: true }, session: null }));
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await expect.poll(() => hasWaveformPixels(page)).toBe(true);
   return page;
}

test("split feedback keeps the waveform below clip labels and handles", async ({ launchApp, profile }) => {
   const page = await openWaveform(launchApp, profile);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + bar.width / 3, bar.y + 36);
   await waitForPlaybackTime(page, 6);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.keyboard.press("s");
   const stacking = await page.evaluate(async () => {
      const frames = [];
      const begin = globalThis.performance.now();
      while (globalThis.performance.now() - begin < 650) {
         await new Promise(globalThis.requestAnimationFrame);
         frames.push(
            ...[...document.querySelectorAll(".clip-range")].map((clip) => {
               const style = globalThis.getComputedStyle(clip);
               return { filter: style.filter, opacity: style.opacity, scale: style.scale, transform: style.transform };
            })
         );
      }
      return frames;
   });
   for (const frame of stacking) {
      expect(frame.filter).toBe("none");
      expect(frame.opacity).toBe("1");
      expect(frame.scale).toBe("none");
      expect(frame.transform).toBe("none");
   }
   await expect.poll(() => hasWaveformPixels(page)).toBe(true);
});

test("waveform bands follow the displayed edges throughout a trim", async ({ launchApp, profile }) => {
   const page = await openWaveform(launchApp, profile);
   await page.evaluate(() => {
      globalThis.trimWaveformFrames = [];
      const post = globalThis.Worker.prototype.postMessage;
      globalThis.Worker.prototype.postMessage = function (message, ...args) {
         if (message.type === "view" && message.view.bands.length === 1) {
            const clip = document.querySelector(".clip-range");
            const canvas = document.querySelector(".clip-waveform");
            const ratio = globalThis.devicePixelRatio || 1;
            const width = canvas.getBoundingClientRect().width * ratio;
            const band = message.view.bands[0];
            globalThis.trimWaveformFrames.push({
               from: band.from,
               to: band.to,
               left: band.left,
               width: band.width,
               clipLeft: (parseFloat(clip.style.left) * width) / 100,
               clipWidth: (parseFloat(clip.style.width) * width) / 100,
            });
         }
         return post.call(this, message, ...args);
      };
   });
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("00:03.00");
   await start.press("Enter");
   await page.waitForTimeout(300);
   const frames = await page.evaluate(() => globalThis.trimWaveformFrames);
   expect(frames.some((frame) => frame.from > 0.1 && frame.from < 2.9)).toBe(true);
   for (const frame of frames) {
      expect(Math.abs(frame.left - frame.clipLeft)).toBeLessThan(0.02);
      expect(Math.abs(frame.width - frame.clipWidth)).toBeLessThan(0.02);
      expect(frame.to).toBe(18);
   }
   expect(frames.at(-1).from).toBeCloseTo(3, 5);
   await expect.poll(() => hasWaveformPixels(page)).toBe(true);
});
