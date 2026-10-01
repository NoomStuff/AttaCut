import { expect } from "@playwright/test";
import { mediaBinary, test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const longVideo = process.env.ATTACUT_LONG_VIDEO || resolve("work/long-video/two-hours.mp4");

test.beforeAll(async () => {
   if (process.env.ATTACUT_LONG_VIDEO) return;
   await mkdir("work/long-video", { recursive: true });
   const ffmpeg = mediaBinary("ffmpeg");
   const segment = resolve("work/long-video/segment.mp4");
   // Small pixels keep fixture generation cheap; 216,000 frames still exercise a real long index.
   // ATTACUT_LONG_VIDEO can replace it with a representative recording for decode benchmarks.
   execFileSync(
      ffmpeg,
      ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=30", "-t", "1", "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", segment],
      { windowsHide: true }
   );
   execFileSync(ffmpeg, ["-v", "error", "-y", "-stream_loop", "7199", "-i", segment, "-c", "copy", "-movflags", "+faststart", longVideo], {
      windowsHide: true,
   });
});

test("opens, plays, scrubs, and steps a multi-hour recording", async ({ launchApp, profile }) => {
   const application = await launchApp(profile, resolve(longVideo));
   const page = await application.firstWindow();
   await waitForVideo(page);
   // A two-hour recording must open natively without a proxy preview.
   await expect(page.getByText(/Preparing preview/i)).toHaveCount(0);

   // Playing advances the clock.
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video")?.currentTime > 1, undefined, { timeout: 30000 });
   await page.getByRole("button", { name: "Pause", exact: true }).click();

   // Jump across the recording: a cold seek into a far region must land, not spin.
   await page.getByRole("textbox", { name: "Clip start", exact: true }).fill("01:30:00");
   const seekStart = Date.now();
   await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
   await page.waitForFunction(() => Math.abs(document.querySelector("video")?.currentTime - 5400) < 0.5, undefined, { timeout: 20000 });
   const seekMs = Date.now() - seekStart;
   console.log(`far seek landed in ${seekMs}ms`);
   // Completion is bounded above. Hardware benchmarks belong in the opt-in runner.

   // Frame stepping works deep into the recording.
   await page.locator(".title-filename").click();
   const beforeStep = await page.evaluate(() => document.querySelector("video").currentTime);
   await page.keyboard.press(".");
   await page.waitForFunction((before) => document.querySelector("video")?.currentTime > before, beforeStep);
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, undefined, { timeout: 15000 });
   expect(await page.evaluate(() => document.querySelector("video").error)).toBeNull();

   // At fit, a nearby cut must not claim the Merge action while splitting inside a clip.
   await page.keyboard.press("Shift+ArrowRight");
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   await page.keyboard.press("Shift+ArrowRight");
   await page.keyboard.press("Shift+ArrowRight");
   await expect(page.getByRole("button", { name: "Merge clips", exact: true })).toBeDisabled();
   await expect(page.getByRole("button", { name: "Split", exact: true })).toBeEnabled();

   // Another cold jump near the end, then resume ordinary source playback.
   await page.getByRole("textbox", { name: "Clip end", exact: true }).fill("01:54:00");
   await page.getByRole("textbox", { name: "Clip end", exact: true }).press("Tab");
   await page.waitForFunction(() => Math.abs(document.querySelector("video")?.currentTime - 6840) < 0.5, undefined, { timeout: 20000 });
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video")?.currentTime > 6840.2, undefined, { timeout: 30000 });
   expect(await page.evaluate(() => document.querySelector("video").error)).toBeNull();
});

test("a captured trim can shrink to one frame at fit without overflowing its clip", async ({ launchApp, profile }) => {
   const application = await launchApp(profile, resolve(longVideo));
   const page = await application.firstWindow();
   await waitForVideo(page);
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   const start = page.getByRole("slider", { name: "Clip 1 start", exact: true });
   const end = page.getByRole("slider", { name: "Clip 1 end", exact: true });
   for (const side of ["end", "start"]) {
      const handle = side === "end" ? end : start;
      const bounds = await handle.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(side === "end" ? viewport.x - 20 : viewport.x + viewport.width + 20, bounds.y + bounds.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => Number(await end.getAttribute("aria-valuenow")) - Number(await start.getAttribute("aria-valuenow"))).toBeCloseTo(1 / 30, 5);
      await expect
         .poll(async () => {
            return page.locator(".clip-range:not(.leaving)").evaluate((clip) => {
               const rect = clip.getBoundingClientRect();
               return [...clip.querySelectorAll(".trim-handle")].every((handle) => {
                  const bounds = handle.getBoundingClientRect();
                  return bounds.width <= rect.width / 2 + 0.02 && bounds.left >= rect.left - 0.02 && bounds.right <= rect.right + 0.02;
               });
            });
         })
         .toBe(true);
      await expect
         .poll(() =>
            page
               .locator(".clip-number")
               .first()
               .evaluate((label) => globalThis.getComputedStyle(label).opacity)
         )
         .toBe("0");
      await page.screenshot({ path: `work/small-clip-playground/one-frame-${side}.png` });
      await page.locator(".title-filename").click();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
      await expect(start).toHaveAttribute("aria-valuenow", "0");
      await expect(end).toHaveAttribute("aria-valuenow", "7200");
   }
   const endField = page.getByRole("textbox", { name: "Clip end", exact: true });
   await endField.fill("00:00.033333");
   await endField.press("Tab");
   await expect.poll(async () => Number(await end.getAttribute("aria-valuenow"))).toBeCloseTo(1 / 30, 5);
   await end.press("ArrowRight");
   await expect.poll(async () => Number(await end.getAttribute("aria-valuenow"))).toBeCloseTo(2 / 30, 5);
   await end.press("ArrowLeft");
   await expect.poll(async () => Number(await end.getAttribute("aria-valuenow"))).toBeCloseTo(1 / 30, 5);
});

test("controlled seek benchmark", async ({ launchApp, profile }) => {
   test.skip(process.env.ATTACUT_SEEK_BENCHMARK !== "1", "Opt-in hardware benchmark");
   const app = await launchApp(profile, resolve(longVideo));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const samples = [];
   for (const time of [5400, 600, 6600, 1800, 4200, 3000, 6840]) {
      samples.push(
         await page.evaluate(async (target) => {
            const video = document.querySelector("video");
            const start = globalThis.performance.now();
            await new Promise((resolve) => {
               video.addEventListener("seeked", resolve, { once: true });
               video.currentTime = target;
            });
            if (Math.abs(video.currentTime - target) > 0.05 || video.readyState < 2) throw new Error("Seek did not decode its target");
            return globalThis.performance.now() - start;
         }, time)
      );
   }
   samples.sort((a, b) => a - b);
   console.log("Decoded seek samples in milliseconds", samples);
   expect(samples[Math.floor(samples.length / 2)]).toBeLessThan(Number(process.env.ATTACUT_SEEK_TARGET_MS || 750));
});
