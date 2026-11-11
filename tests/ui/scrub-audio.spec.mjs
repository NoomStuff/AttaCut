/* global window */
import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("default audio scrubbing auditions a held snapped cut once and hover stays quiet on a roomy clip", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.evaluate(() => {
      const start = window.AudioBufferSourceNode.prototype.start;
      window.scrubAuditions = [];
      window.scrubPcm = [];
      window.AudioBufferSourceNode.prototype.start = function (...args) {
         window.scrubAuditions.push(args);
         const [, offset, duration] = args;
         const samples = this.buffer
            .getChannelData(0)
            .subarray(Math.floor(offset * this.buffer.sampleRate), Math.ceil((offset + duration) * this.buffer.sampleRate));
         window.scrubPcm.push({
            frames: samples.length,
            rms: Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length),
            context: this.context,
         });
         return start.apply(this, args);
      };
   });
   await page.getByRole("button", { name: "Settings", exact: true }).click();
   await page.getByRole("tab", { name: "Editing" }).click();
   await expect(page.getByRole("switch", { name: "Audio scrubbing", exact: true })).toBeChecked();
   await page.keyboard.press("Escape");
   await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "detached" });
   const magnet = page.getByRole("button", { name: "Snap to keyframes", exact: true });
   await magnet.click();
   await expect(page.locator(".keyframe-tick").first()).toBeVisible();
   const handle = page.getByRole("slider", { name: "Clip 1 end", exact: true });
   const bounds = await handle.boundingBox();
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
   const direction = page.locator(".handle-direction.end.active");
   // A roomy clip keeps its handles legible on their own, so hovering never raises the carets.
   await expect.poll(() => direction.locator("svg").evaluate((el) => window.getComputedStyle(el).opacity)).toBe("0");
   await expect(page.locator(".handle-direction.start.active")).toHaveCount(0);
   await page.mouse.down();
   await page.mouse.move(bar.x + (bar.width * 6.2) / 18, bounds.y + bounds.height / 2);
   await expect.poll(() => page.evaluate(() => window.scrubAuditions.filter(([, offset]) => Math.abs(offset - 0.84) < 0.001).length)).toBe(1);
   await expect
      .poll(() => page.evaluate(() => window.scrubPcm.some(({ frames, rms, context }) => frames > 0 && rms > 0.01 && context.state === "running")))
      .toBe(true);
   for (let i = 0; i < 16; i++) {
      await page.mouse.move(bar.x + (bar.width * (6.2 + (i % 2 ? 0.1 : -0.1))) / 18, bounds.y + bounds.height / 2);
   }
   await page.screenshot({ path: "work/audio-scrub-playground/handle-hover.png" });
   expect(await page.evaluate(() => window.scrubAuditions.filter(([, offset]) => Math.abs(offset - 0.84) < 0.001).length)).toBe(1);
   await page.mouse.up();
   await page.getByRole("button", { name: "Mute preview", exact: true }).click();
   const before = await page.evaluate(() => window.scrubAuditions.length);
   const mutedHandle = await handle.boundingBox();
   await page.mouse.move(mutedHandle.x + mutedHandle.width / 2, mutedHandle.y + mutedHandle.height / 2);
   await page.mouse.down();
   await page.mouse.move(bar.x + (bar.width * 8.2) / 18, mutedHandle.y + mutedHandle.height / 2);
   await page.mouse.up();
   await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeCloseTo(8, 6);
   expect(await page.evaluate(() => window.scrubAuditions.length)).toBe(before);
   await page.mouse.move(bar.x + bar.width / 2, bar.y);
   await expect.poll(() => page.locator(".handle-direction.end > svg").evaluate((el) => window.getComputedStyle(el).opacity)).toBe("0");
});
