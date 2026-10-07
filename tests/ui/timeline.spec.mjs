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
   await page.getByRole("button", { name: "Settings", exact: true }).click();
   await page.getByRole("tab", { name: "Editing" }).click();
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

for (const startTime of [8, 16]) {
   test(`playback zoom at ${startTime}s retains wheel events and respects recording and follow bounds`, async ({ launchApp, profile }) => {
      const app = await launchApp(profile, resolve("work/fixture.mp4"));
      const page = await app.firstWindow();
      await waitForVideo(page);
      const bar = await page.locator(".timeline-viewport").boundingBox();
      await page.mouse.click(bar.x + (bar.width * startTime) / 18, bar.y + 36);
      await waitForPlaybackTime(page, startTime);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      const wheel = async (delta, count) => {
         await page.evaluate(
            ({ delta, count }) => {
               const section = document.querySelector(".timeline-section");
               const bounds = document.querySelector(".timeline-viewport").getBoundingClientRect();
               for (let index = 0; index < count; index++)
                  section.dispatchEvent(
                     new globalThis.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: delta, clientX: bounds.x + bounds.width * 0.05 })
                  );
            },
            { delta, count }
         );
      };
      await page.evaluate(() => {
         globalThis.zoomBounds = [];
         globalThis.sampleZoom = true;
         const sample = () => {
            const clip = document.querySelector(".clip-range");
            const left = parseFloat(clip.style.left);
            const width = parseFloat(clip.style.width);
            const video = document.querySelector("video");
            const length = (100 * video.duration) / width;
            const start = (-left * length) / 100;
            globalThis.zoomBounds.push({ left, right: left + width, start, length, time: video.currentTime });
            if (globalThis.sampleZoom) globalThis.requestAnimationFrame(sample);
         };
         globalThis.requestAnimationFrame(sample);
      });
      // These events share a render batch. Each notch must still change the target.
      await wheel(-100, 4);
      await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("182%");
      await page.waitForFunction(() => globalThis.zoomBounds.length >= 8);
      await wheel(-100, 4);
      await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("332%");
      await page.waitForFunction(() => globalThis.zoomBounds.length >= 16);
      await wheel(100, 8);
      await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("100%");
      await page.waitForFunction(() => globalThis.zoomBounds.length >= 35);
      const frames = await page.evaluate(() => {
         globalThis.sampleZoom = false;
         return globalThis.zoomBounds;
      });
      // The full-source clip must cover the viewport throughout each tween.
      expect(Math.max(...frames.map((frame) => frame.left))).toBeLessThanOrEqual(0.001);
      expect(Math.min(...frames.map((frame) => frame.right))).toBeGreaterThanOrEqual(99.999);
      // Zooming towards the far left must not push playback beyond its right margin
      // and then trigger a corrective pan back. Check the whole animation, not its end.
      for (const frame of frames) {
         if (frame.start > 0.01) expect(frame.time - frame.start).toBeGreaterThanOrEqual(frame.length * 0.1 - 0.1);
         if (frame.start + frame.length < 17.99) expect(frame.time - frame.start).toBeLessThanOrEqual(frame.length * 0.9 + 0.1);
      }
   });
}

for (const cursor of [-0.1, 0.05, 0.95, 1.1]) {
   test(`zoom-out with an outside cursor at ${cursor} finishes without a sideways snap`, async ({ launchApp, profile }) => {
      const app = await launchApp(profile, resolve("work/fixture.mp4"));
      const page = await app.firstWindow();
      await waitForVideo(page);
      const bar = await page.locator(".timeline-viewport").boundingBox();
      await page.mouse.click(bar.x + bar.width / 2, bar.y + 36);
      await waitForPlaybackTime(page, 9);
      for (let index = 0; index < 16; index++) await page.keyboard.press("=");
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page.evaluate(async (cursor) => {
         const section = document.querySelector(".timeline-section");
         const bounds = document.querySelector(".timeline-viewport").getBoundingClientRect();
         globalThis.zoomOutFrames = [];
         let targetLength = 0.5;
         for (let pass = 0; pass < 3; pass++) {
            const before = document.querySelector(".clip-range");
            const fromLength = 1800 / parseFloat(before.style.width);
            const start = (-parseFloat(before.style.left) * fromLength) / 100;
            const fraction = Math.max(0, Math.min(1, cursor));
            const focus = start + fraction * fromLength;
            targetLength *= Math.exp(0.45);
            const time = document.querySelector("video").currentTime;
            const minimum = Math.max(0, Math.min(18 - targetLength, time - 0.9 * targetLength));
            const maximum = Math.max(0, Math.min(18 - targetLength, time - 0.1 * targetLength));
            globalThis.zoomOutAnchor = { start: Math.max(minimum, Math.min(maximum, focus - fraction * targetLength)), length: targetLength };
            section.dispatchEvent(
               new globalThis.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 500, clientX: bounds.x + bounds.width * cursor })
            );
            const begin = globalThis.performance.now();
            // Retarget while the preceding zoom is still running. Its target range
            // differs from the visible range, especially at the soft follow margins.
            while (globalThis.performance.now() - begin < (pass === 2 ? 650 : 60)) {
               await new Promise(globalThis.requestAnimationFrame);
               const clip = document.querySelector(".clip-range");
               const length = 1800 / parseFloat(clip.style.width);
               globalThis.zoomOutFrames.push({
                  pass,
                  elapsed: globalThis.performance.now() - begin,
                  start: (-parseFloat(clip.style.left) * length) / 100,
                  length,
                  time: document.querySelector("video").currentTime,
                  from: { start, length: fromLength },
                  target: globalThis.zoomOutAnchor,
               });
            }
         }
      }, cursor);
      const frames = await page.evaluate(() => globalThis.zoomOutFrames);
      const expected = await page.evaluate(() => globalThis.zoomOutAnchor);
      const final = frames.at(-1);
      const minimum = Math.max(0, Math.min(18 - expected.length, final.time - 0.9 * expected.length));
      const maximum = Math.max(0, Math.min(18 - expected.length, final.time - 0.1 * expected.length));
      expect(final.length).toBeCloseTo(expected.length, 5);
      expect(final.start).toBeCloseTo(Math.max(minimum, Math.min(maximum, expected.start)), 1);
      for (const frame of frames) {
         const progress = Math.max(0, Math.min(1, (frame.length - frame.from.length) / (frame.target.length - frame.from.length)));
         const interpolated = frame.from.start + (frame.target.start - frame.from.start) * progress;
         const low = Math.max(0, Math.min(18 - frame.length, frame.time - 0.9 * frame.length));
         const high = Math.max(0, Math.min(18 - frame.length, frame.time - 0.1 * frame.length));
         const bounded = Math.max(low, Math.min(high, interpolated));
         // Playback can move the destination during this interpolation. Allow its
         // elapsed source time, but reject a position animation with a different origin.
         expect(Math.abs(frame.start - bounded)).toBeLessThanOrEqual(frame.elapsed / 1000 + 0.03);
      }
      // Once the zoom settles, only normal playback following should move the view.
      // Measure source-time movement to allow different display and decoding rates.
      for (let index = 1; index < frames.length; index++) {
         const current = frames[index];
         const previous = frames[index - 1];
         if (current.pass !== previous.pass || previous.elapsed < 300) continue;
         const playback = Math.abs(current.time - previous.time);
         expect(Math.abs(current.start - previous.start)).toBeLessThanOrEqual(playback + current.length * 0.025);
      }
   });
}

test("frame-level zoom quantizes the playhead to source frames", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   // Twelve steps reach the 1500% level: only 36 frames of the 18-second fixture fit the view.
   for (let index = 0; index < 12; index++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
   // The drawn view chases the zoom target; let it settle so the pick maps predictably.
   await page.waitForTimeout(400);
   await page.mouse.click(bar.x + bar.width * 0.41, bar.y + 36);
   // 41% of the 1.2s view lands near 0.492s, which rounds to frame 15 at 00:00.50.
   await expect(page.locator(".timeline-time time").first()).toHaveText("00:00.50");
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
   await page.getByRole("button", { name: "Settings", exact: true }).click();
   await page.getByRole("tab", { name: "Editing" }).click();
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
