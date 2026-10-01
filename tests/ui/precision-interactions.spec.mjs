/* global window, Event */
import { expect } from "@playwright/test";
import { test, waitForVideo, waitForPlaybackTime } from "./app.mjs";
import { resolve } from "node:path";

const waitForFrame = (page, time) =>
   page.waitForFunction((target) => {
      const video = document.querySelector("video");
      return video && !video.seeking && Math.abs(video.currentTime - target) < 0.00001;
   }, time);

for (const reducedMotion of ["no-preference", "reduce"])
   test("Alt split, undo and compact clip numbers with " + reducedMotion, async ({ launchApp, profile }) => {
      const app = await launchApp(profile, resolve("work/fixture.mp4"));
      const page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion });
      await waitForVideo(page);
      const magnet = page.getByRole("button", { name: "Snap to keyframes", exact: true });
      await magnet.click();
      await expect(page.locator(".keyframe-tick").first()).toBeVisible();
      await magnet.click();
      const bar = await page.locator(".timeline-viewport").boundingBox();
      await page.mouse.click(bar.x + (bar.width * 3.2) / 18, bar.y + 36);
      await waitForFrame(page, 3.2);
      await page.keyboard.down("Alt");
      await page.keyboard.press("s");
      const second = page.getByRole("slider", { name: "Clip 2 start", exact: true });
      await expect.poll(async () => Number(await second.getAttribute("aria-valuenow"))).toBeCloseTo(4, 6);
      await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
      await expect(second).toHaveCount(0);
      await page.keyboard.up("Alt");
      const endSlider = page.getByRole("slider", { name: "Clip 1 end", exact: true });
      await expect(endSlider).toHaveAttribute("aria-valuenow", "18");
      await expect
         .poll(async () => {
            const bounds = await endSlider.boundingBox();
            return bounds.x + bounds.width;
         })
         .toBeCloseTo(bar.x + bar.width, 0);
      const end = await endSlider.boundingBox();
      await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
      await page.mouse.down();
      await expect(endSlider).toHaveClass(/dragging/);
      if (reducedMotion === "no-preference")
         await page.evaluate(() => {
            window.clipNumberFaded = false;
            const sample = () => {
               const clip = document.querySelector('.clip-range[data-compact="true"]');
               const label = clip?.querySelector(".clip-number");
               const opacity = label && Number(window.getComputedStyle(label).opacity);
               if (opacity > 0 && opacity < 1) window.clipNumberFaded = true;
               if (opacity !== 0) window.requestAnimationFrame(sample);
            };
            window.requestAnimationFrame(sample);
         });
      await page.mouse.move(bar.x + 24, end.y + end.height / 2);
      const label = page.locator(".clip-range:not(.leaving) .clip-number");
      await expect.poll(() => label.evaluate((el) => window.getComputedStyle(el).opacity)).toBe("0");
      if (reducedMotion === "no-preference") expect(await page.evaluate(() => window.clipNumberFaded)).toBe(true);
      await page.mouse.move(bar.x + 70, end.y + end.height / 2);
      await expect.poll(() => label.evaluate((el) => window.getComputedStyle(el).opacity)).toBe("1");
      await page.mouse.up();
   });

test("Alt snapping is temporary, follows a scrub, and releases on blur", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const magnet = page.getByRole("button", { name: "Snap to keyframes", exact: true });
   await magnet.click();
   await expect(page.locator(".keyframe-tick").first()).toBeVisible();
   await magnet.click();
   await expect(magnet).toHaveAttribute("aria-pressed", "false");
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.keyboard.down("Alt");
   await expect(magnet).toHaveAttribute("aria-pressed", "true");
   await page.mouse.move(bar.x + (bar.width * 3.2) / 18, bar.y + 36);
   await page.mouse.down();
   await page.mouse.move(bar.x + (bar.width * 5.2) / 18, bar.y + 36);
   await waitForPlaybackTime(page, 6);
   await page.keyboard.up("Alt");
   await expect(magnet).toHaveAttribute("aria-pressed", "false");
   await page.mouse.move(bar.x + (bar.width * 5.2) / 18 + 2, bar.y + 36);
   await page.mouse.up();
   await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeCloseTo(5.2 + 36 / bar.width, 1);
   await page.keyboard.down("Alt");
   await expect(magnet).toHaveAttribute("aria-pressed", "true");
   await page.evaluate(() => window.dispatchEvent(new Event("blur")));
   await expect(magnet).toHaveAttribute("aria-pressed", "false");
   await page.keyboard.up("Alt");
   await page.keyboard.press("Shift+.");
   await waitForPlaybackTime(page, 6);
   await page.keyboard.press("Shift+,");
   await waitForPlaybackTime(page, 4);
   await page.keyboard.press("Alt+ArrowRight");
   await waitForPlaybackTime(page, 6);
   await expect(magnet).toHaveAttribute("aria-pressed", "false");
   const start = page.getByRole("slider", { name: "Clip 1 start", exact: true });
   const handle = await start.boundingBox();
   await page.keyboard.down("Alt");
   await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
   await page.mouse.down();
   await page.mouse.move(bar.x + (bar.width * 3.2) / 18, handle.y + handle.height / 2);
   await expect.poll(async () => Number(await start.getAttribute("aria-valuenow"))).toBeCloseTo(4, 6);
   await page.keyboard.up("Alt");
   await page.mouse.move(bar.x + (bar.width * 3) / 18, handle.y + handle.height / 2);
   await page.mouse.up();
   await expect.poll(async () => Number(await start.getAttribute("aria-valuenow"))).toBeCloseTo(3, 6);
   await magnet.click();
   await page.keyboard.down("Alt");
   await page.keyboard.up("Alt");
   await expect(magnet).toHaveAttribute("aria-pressed", "true");
   await magnet.click();
   await app.close();
   const reopened = await launchApp(profile, resolve("work/fixture.mp4"));
   const restored = await reopened.firstWindow();
   await waitForVideo(restored);
   await expect(restored.getByRole("button", { name: "Snap to keyframes", exact: true })).toHaveAttribute("aria-pressed", "false");
});

test("merge and split meet at the next frame, and held trims dim the playhead", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + (bar.width * 4) / 18, bar.y + 36);
   await waitForPlaybackTime(page, 4);
   await page.keyboard.press("s");
   const endField = page.getByRole("textbox", { name: "Clip end", exact: true });
   await endField.fill("4.1");
   await endField.press("Tab");
   await page.locator(".title-filename").click();
   // An end handle shows the last included frame. Step beyond it before stepping back.
   await waitForFrame(page, 4 + 2 / 30);
   await page.keyboard.press(".");
   await waitForFrame(page, 4.1);
   for (const time of [4 + 2 / 30, 4 + 1 / 30]) {
      await page.keyboard.press(",");
      await waitForFrame(page, time);
      await expect(page.getByRole("button", { name: "Split", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Merge clips", exact: true })).toBeDisabled();
   }
   await page.keyboard.press(",");
   await waitForFrame(page, 4);
   await expect(page.getByRole("button", { name: "Split", exact: true })).toBeDisabled();
   await expect(page.getByRole("button", { name: "Merge clips", exact: true })).toBeEnabled();
   await page.keyboard.press(".");
   await waitForFrame(page, 4 + 1 / 30);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 3 end", exact: true })).toBeVisible();
   const handle = await page.getByRole("slider", { name: "Clip 3 end", exact: true }).boundingBox();
   await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
   await page.mouse.down();
   await expect.poll(() => page.locator(".playhead").evaluate((el) => Number(window.getComputedStyle(el).opacity))).toBe(0.25);
   await page.mouse.up();
   await expect.poll(() => page.locator(".playhead").evaluate((el) => Number(window.getComputedStyle(el).opacity))).toBe(1);
});

test("export rows dim when excluded and help returns through its normal close control", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await expect(page.getByRole("button", { name: "Play kept clips only", exact: true })).toHaveCount(0);
   await expect(page.getByRole("button", { name: "Next cut", exact: true })).toBeVisible();
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + (bar.width * 4) / 18, bar.y + 36);
   await waitForPlaybackTime(page, 4);
   await page.keyboard.press("s");
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("checkbox", { name: "Export clip 2", exact: true }).uncheck();
   await expect.poll(() => page.locator('.export-clip-entry[data-included="false"]').evaluate((el) => Number(window.getComputedStyle(el).opacity))).toBe(0.65);
   await expect(page.locator(".export-source-range, .export-total")).toHaveCount(0);
   await page.getByRole("button", { name: "Learn More", exact: true }).click();
   const help = page.getByRole("dialog", { name: "Help", exact: true });
   await expect(help).not.toContainText("boundary re-encoding");
   await expect(help.getByRole("button", { name: "Back to export", exact: true })).toHaveCount(0);
   await help.getByRole("button", { name: "Close panel", exact: true }).click();
   await expect(page.getByRole("checkbox", { name: "Export clip 2", exact: true })).not.toBeChecked();
});
