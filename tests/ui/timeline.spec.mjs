/* global window, KeyboardEvent */
import { expect } from "@playwright/test";
import { test, waitForPlaybackTime, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("time fields keep readable precision and align to source frames without another edit", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const field = page.getByRole("textbox", { name: "Clip start", exact: true });
   await field.fill("00:01.23");
   await field.press("Tab");
   const handle = page.getByRole("slider", { name: "Clip 1 start", exact: true });
   await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeCloseTo(1.233333333, 5);
   await expect(page.locator(".time-feedback")).toHaveCount(0);
   await expect(page.locator(".timeline-time time").first()).toHaveText("00:01.23");
   const before = await handle.getAttribute("aria-valuenow");
   await expect(page.locator(".player-excluded")).toHaveClass(/hidden/);
   await expect(page.getByRole("button", { name: "Add clip in gap", exact: true })).toBeEnabled();
   await field.click();
   await expect(field).toHaveValue("00:01.23");
   await expect(field).toHaveAttribute("title", "00:01.233333");
   await field.press("Tab");
   expect(await handle.getAttribute("aria-valuenow")).toBe(before);
   await page.locator(".title-filename").click();
   await page.keyboard.press(process.platform === "darwin" ? "Meta+Z" : "Control+Z");
   await expect(handle).toHaveAttribute("aria-valuenow", "0");
});

test("frame stepping advances from the included end frame and can cross the cutoff", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.locator("video").evaluate((video) => {
      const record = (_now, metadata) => {
         globalThis.presentedFrameTime = metadata.mediaTime;
         video.requestVideoFrameCallback(record);
      };
      video.requestVideoFrameCallback(record);
   });
   const end = page.getByRole("textbox", { name: "Clip end", exact: true });
   await end.fill("00:02.00");
   await end.press("Tab");
   await page.getByRole("slider", { name: "Clip 1 end", exact: true }).click();
   const video = page.locator("video");
   const atFrame = async (time) => {
      await expect.poll(() => video.evaluate((element) => element.currentTime)).toBeCloseTo(time, 4);
      await expect.poll(() => page.evaluate(() => globalThis.presentedFrameTime)).toBeCloseTo(time, 4);
   };
   await atFrame(2 - 1 / 30);
   await page.keyboard.press(",");
   await atFrame(2 - 2 / 30);
   await page.keyboard.press(".");
   await atFrame(2 - 1 / 30);
   await page.keyboard.press(".");
   await atFrame(2);
});

test("touching clip handles inspect their own included frame while held", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.locator("video").evaluate((video) => {
      const record = (_now, metadata) => {
         globalThis.presentedFrameTime = metadata.mediaTime;
         video.requestVideoFrameCallback(record);
      };
      video.requestVideoFrameCallback(record);
   });
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(viewport.x + (viewport.width * 2) / 18, viewport.y + 36);
   await waitForPlaybackTime(page, 2);
   await page.keyboard.press("s");
   const left = page.getByRole("slider", { name: "Clip 1 end", exact: true });
   const right = page.getByRole("slider", { name: "Clip 2 start", exact: true });
   await expect(right).toBeVisible();
   const seam = Number(await left.getAttribute("aria-valuenow"));
   for (const [handle, frame] of [
      [left, seam - 1 / 30],
      [right, seam],
   ]) {
      const bounds = await handle.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      await page.mouse.down();
      await expect.poll(() => page.evaluate(() => globalThis.presentedFrameTime)).toBeCloseTo(frame, 4);
      await page.mouse.up();
      await expect.poll(() => page.evaluate(() => globalThis.presentedFrameTime)).toBeCloseTo(frame, 4);
   }
});

test("keyframe ticks stay at their source position while a clip edge follows a drag", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.getByRole("button", { name: "Snap to keyframes", exact: true }).click();
   const tick = page.locator(".keyframe-tick").nth(2);
   await expect(tick).toBeVisible();
   const keyframe = await tick.getAttribute("data-time");
   const handle = await page.getByRole("slider", { name: "Clip 1 start", exact: true }).boundingBox();
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
   await page.mouse.down();
   await page.evaluate((keyframe) => {
      globalThis.tickPositions = [];
      const record = () => {
         const tick = document.querySelector(`.keyframe-tick[data-time="${keyframe}"]`);
         if (tick) globalThis.tickPositions.push(tick.getBoundingClientRect().x);
         if (globalThis.tickPositions.length < 20) globalThis.requestAnimationFrame(record);
      };
      globalThis.requestAnimationFrame(record);
   }, keyframe);
   await page.mouse.move(viewport.x + (viewport.width * 2) / 18, handle.y + handle.height / 2, { steps: 8 });
   await page.waitForFunction(() => globalThis.tickPositions.length >= 12);
   const positions = await page.evaluate(() => globalThis.tickPositions);
   expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1.5);
   await page.mouse.up();
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "2");
});

test("time fields and editing preserve active playback", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/named-audio.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   const bar = await page.locator(".timeline-viewport").boundingBox();
   const seek = async (time) => {
      if (time === 18) {
         await page.mouse.click(bar.x + bar.width - 2, bar.y + 36);
      } else {
         await page.mouse.click(bar.x + (bar.width * time) / 18, bar.y + 36);
      }
      await waitForPlaybackTime(page, time);
   };
   await seek(4);
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   const end = page.getByRole("textbox", { name: "Clip end", exact: true });
   await start.focus();
   await start.press("Tab");
   await end.press("Tab");
   expect(await video.evaluate((video) => video.currentTime)).toBeCloseTo(4, 1);
   await start.fill("0:00");
   await start.press("Tab");
   expect(await video.evaluate((video) => video.currentTime)).toBeCloseTo(4, 1);
   await page.getByRole("button", { name: "Preview audio tracks", exact: true }).click();
   await expect(page.getByRole("option", { name: "Game audio", exact: true })).toBeVisible();
   await page.keyboard.press("Escape");
   await expect(page.getByRole("option", { name: "Game audio", exact: true })).toHaveCount(0);
   await page.getByRole("button", { name: "Preview audio tracks", exact: true }).click();
   await page.getByRole("option", { name: "Microphone", exact: true }).click();
   await page.getByRole("button", { name: "Playback settings", exact: true }).click();
   await page.getByRole("switch", { name: "Keep playing while editing", exact: true }).check();
   await page.keyboard.press("Escape");
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await seek(6);
   await expect(video).toHaveJSProperty("paused", false);
   await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true })));
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   await expect(video).toHaveJSProperty("paused", false);
   await start.focus();
   await start.press("Tab");
   await end.press("Tab");
   await expect(video).toHaveJSProperty("paused", false);
   await page.getByRole("button", { name: "Pause", exact: true }).click();
   await page.keyboard.press("ArrowRight");
   expect(await page.getByRole("button", { name: "Play", exact: true }).evaluate((button) => button.matches(":focus-visible"))).toBe(false);
   await expect(video).toHaveJSProperty("paused", true);
});

test("timeline zoom and pan preserve the playhead", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/named-audio.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.getByRole("button", { name: "Zoom in", exact: true }).click();
   await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("125%");
   await expect(page.getByRole("slider", { name: "Pan timeline", exact: true })).toHaveCount(0);
   for (const percent of [150, 200, 250, 300, 400, 500, 600, 800, 1000]) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText(`${percent}%`);
   }
   await page.getByRole("button", { name: "Fit timeline", exact: true }).click();
   await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("100%");
   await page.getByRole("button", { name: "Zoom in", exact: true }).click();
   await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("125%");
   const cursor = await video.evaluate((video) => video.currentTime);
   const range = page.locator(".clip-range").first();
   const before = await range.getAttribute("style");
   await page.mouse.move(bar.x + bar.width * 0.6, bar.y + 36);
   await page.mouse.down({ button: "middle" });
   await page.mouse.move(bar.x + bar.width * 0.4, bar.y + 36, { steps: 8 });
   await page.mouse.up({ button: "middle" });
   expect(await range.getAttribute("style")).not.toBe(before);
   expect(await video.evaluate((video) => video.currentTime)).toBe(cursor);
   await page.keyboard.down("Alt");
   await page.mouse.wheel(0, -200);
   await page.keyboard.up("Alt");
   await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("125%");
   expect(await video.evaluate((video) => video.currentTime)).toBe(cursor);
   await page.getByRole("button", { name: "Pan timeline right", exact: true }).click();
   expect(Number(await page.locator(".timeline-pan-arrow.left").evaluate((el) => el.style.opacity))).toBeGreaterThan(0);
   while (await page.getByRole("button", { name: "Pan timeline right", exact: true }).isEnabled())
      await page.getByRole("button", { name: "Pan timeline right", exact: true }).click();
   await expect(page.locator(".timeline-pan-arrow.right")).toHaveCSS("opacity", "0");
   await page.getByRole("button", { name: "Fit timeline", exact: true }).click();
   await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("100%");
});

test("excluded-end feedback and default edit pause", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/named-audio.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   const bar = await page.locator(".timeline-viewport").boundingBox();
   const seek = async (time) => {
      if (time === 18) {
         await page.mouse.click(bar.x + bar.width - 2, bar.y + 36);
      } else {
         await page.mouse.click(bar.x + (bar.width * time) / 18, bar.y + 36);
      }
      await waitForPlaybackTime(page, time);
   };
   await seek(6);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   const end = page.getByRole("textbox", { name: "Clip end", exact: true });
   // Position picks map against the drawn view, which is still chasing the fit for ~240ms.
   await page.waitForTimeout(300);
   await seek(18);
   await expect(page.locator(".player-excluded")).toHaveClass(/hidden/);
   await end.fill("00:17.00");
   await end.press("Tab");
   await expect(end).toHaveValue("00:17.00");
   await expect(page.getByRole("slider", { name: "Clip 2 end", exact: true })).toHaveAttribute("aria-valuenow", "17");
   // The moving handle crosses 17.5 during the trim animation and would intercept this click.
   await expect(page.locator(".editor-dock")).not.toHaveClass(/trim-animating/);
   await seek(17.5);
   await expect(page.locator(".player-excluded")).not.toHaveClass(/hidden/);
   await page.getByRole("button", { name: "Playback settings", exact: true }).click();
   await page.getByRole("switch", { name: "Keep playing while editing", exact: true }).uncheck();
   await page.keyboard.press("Escape");
   await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "detached" });
   await seek(4);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await seek(8);
   await expect(video).toHaveJSProperty("paused", true);
   await page.setViewportSize({ width: 800, height: 560 });
   const full = await page.getByRole("button", { name: "Fullscreen video", exact: true }).boundingBox();
   expect(full.x + full.width).toBeLessThanOrEqual(800);
});
