import { expect } from "@playwright/test";
import sharp from "sharp";
import { resolve } from "node:path";
import { test, waitForVideo, waitForPlaybackTime, observeNativeFullscreen, waitForNativeFullscreen } from "./app.mjs";

// Compare the presented picture against the decoded frame, including letterboxing.
// DOM bounds alone cannot detect a misplaced Windows video overlay.
async function expectPresentedFrame(page, testInfo, name) {
   const stage = page.locator(".player-stage");
   expect(await stage.evaluate((element) => [element.scrollLeft, element.scrollTop]), `${name}: controls must not scroll the video`).toEqual([0, 0]);
   const actual = await stage.screenshot({ animations: "allow" });
   // Capture the video first. Only then add a canvas reference, so adding it cannot
   // repair a stale video overlay before we inspect the actual presentation.
   await page.locator("video").evaluate((video) => {
      const canvas = document.createElement("canvas");
      canvas.id = "fullscreen-frame-reference";
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
      canvas.style.cssText = "position:fixed;inset:0;z-index:1000;pointer-events:none";
      const context = canvas.getContext("2d");
      context.fillStyle = "black";
      context.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      document.body.append(canvas);
   });
   let expected;
   try {
      // Screenshot capture also works for a canvas tainted by the media protocol.
      expected = await page.locator("#fullscreen-frame-reference").screenshot({ path: testInfo.outputPath(`${name}-reference.png`) });
   } finally {
      await page.locator("#fullscreen-frame-reference").evaluate((canvas) => canvas.remove());
   }
   await testInfo.attach(name, { body: actual, contentType: "image/png" });
   const normalize = async (buffer) => {
      const { width, height } = await sharp(buffer).metadata();
      // Exclude the controls and top-left clip hint, but retain enough of the
      // test pattern to catch a shifted, stretched or collapsed picture.
      return sharp(buffer)
         .extract({ left: Math.round(width * 0.2), top: Math.round(height * 0.25), width: Math.floor(width * 0.6), height: Math.floor(height * 0.5) })
         .resize(160, 90)
         .removeAlpha()
         .raw()
         .toBuffer();
   };
   const decoded = await normalize(expected);
   const presented = await normalize(actual);
   // Compare the pattern's channel boundaries rather than exact colors. Chromium's
   // video and canvas paths can convert saturated YUV colors differently.
   const mismatch = decoded.reduce((sum, value, index) => sum + Number(value >= 128 !== presented[index] >= 128), 0) / decoded.length;
   expect(mismatch, `${name}: presented pixels must match the centered decoded frame`).toBeLessThan(0.025);
}

test("paused fullscreen keeps its frame and position through controls and window changes", async ({ launchApp, profile }, testInfo) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await observeNativeFullscreen(app);
   const video = page.locator("video");
   if (!(await video.evaluate((element) => element.paused))) {
      await page.getByRole("button", { name: "Pause", exact: true }).click();
   }
   const timeline = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(timeline.x + timeline.width / 3, timeline.y + 36);
   await waitForPlaybackTime(page, 6);
   const originalTime = await video.evaluate((element) => {
      globalThis.fullscreenVideo = element;
      globalThis.fullscreenSeeks = 0;
      element.addEventListener("seeking", () => globalThis.fullscreenSeeks++);
      return element.currentTime;
   });
   for (let cycle = 0; cycle < 2; cycle++) {
      await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
      await waitForNativeFullscreen(app, true);
      await expect
         .poll(() =>
            page.evaluate(() => {
               const rect = document.querySelector(".player-stage").getBoundingClientRect();
               return [rect.x, rect.y, rect.width, rect.height];
            })
         )
         .toEqual(await page.evaluate(() => [0, 0, globalThis.innerWidth, globalThis.innerHeight]));
      await expectPresentedFrame(page, testInfo, `fullscreen-${cycle}`);
      await page.locator(".player-stage").hover();
      await page.evaluate(() => document.dispatchEvent(new globalThis.Event("visibilitychange")));
      // Cocoa and Openbox ignore iconifying a native fullscreen window. Exercise
      // their supported exit/minimize/restore/re-enter sequence with the same frame.
      if (process.platform !== "win32") {
         await app.evaluate(({ BrowserWindow }) => {
            globalThis.fullscreenExitSettled = false;
            BrowserWindow.getAllWindows()[0].once("leave-full-screen", () => {
               globalThis.fullscreenExitSettled = true;
            });
         });
         await page.keyboard.press("Escape");
         await expect.poll(() => app.evaluate(() => globalThis.fullscreenExitSettled)).toBe(true);
         await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
         await waitForNativeFullscreen(app, false);
      }
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
      if (process.platform !== "win32") {
         await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
         await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
         await waitForNativeFullscreen(app, true);
      }
      await expectPresentedFrame(page, testInfo, `restored-${cycle}`);
      await page.keyboard.press("Escape");
      await expect(page.locator(".player-stage.fullscreen")).toHaveCount(0);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
      await waitForNativeFullscreen(app, false);
      expect(await video.evaluate((element) => element === globalThis.fullscreenVideo)).toBe(true);
      expect(await video.evaluate((element) => element.currentTime)).toBe(originalTime);
      expect(await page.evaluate(() => globalThis.fullscreenSeeks)).toBe(0);
   }
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await page.locator(".fullscreen-bar").getByRole("button", { name: "Play", exact: true }).click();
   await expect(page.locator(".fullscreen-controls")).toHaveClass(/hidden/);
   await page.keyboard.press("Space");
   await expect(video).toHaveJSProperty("paused", true);
   await expect(page.locator(".fullscreen-controls")).not.toHaveClass(/hidden/);
   await expectPresentedFrame(page, testInfo, "paused-after-controls-fade");
});

for (const motion of ["no-preference", "reduce"]) {
   test(`fullscreen exits immediately while the preview returns with ${motion}`, async ({ launchApp, profile }) => {
      const app = await launchApp(profile, resolve("work/fixture.mp4"));
      const page = await app.firstWindow();
      await page.emulateMedia({ reducedMotion: motion });
      await waitForVideo(page);
      await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
      const video = page.locator("video");
      const time = await video.evaluate((video) => video.currentTime);
      const state = await page.evaluate(async () => {
         const stage = document.querySelector(".player-stage");
         await Promise.all(stage.getAnimations().map((animation) => animation.finished));
         stage.style.animationPlayState = "paused";
         // Freeze the return animation to prove it cannot delay the native exit.
         const closing = new Promise((resolve) => {
            const observer = new globalThis.MutationObserver(() => {
               if (!stage.classList.contains("fullscreen-returning")) return;
               observer.disconnect();
               resolve({
                  animation: globalThis.getComputedStyle(stage).animationName,
               });
            });
            observer.observe(stage, { attributes: true, attributeFilter: ["class"] });
         });
         document.querySelector('button[aria-label="Exit fullscreen"]').click();
         return closing;
      });
      expect(state.animation).toBe(motion === "reduce" ? "none" : "fullscreen-return");
      await expect(page.locator(".player-stage.fullscreen")).toHaveCount(0);
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
      if (motion === "no-preference") {
         await expect(page.locator(".player-stage")).toHaveClass(/fullscreen-returning/);
         await page.locator(".player-stage").evaluate((stage) => {
            stage.style.animationPlayState = "";
         });
         await expect(page.locator(".player-stage")).not.toHaveClass(/fullscreen-returning/);
      }
      expect(await video.evaluate((video) => video.currentTime)).toBe(time);
   });
}

test("fullscreen can re-enter during return motion and finish when reduced motion is enabled", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await observeNativeFullscreen(app);
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
   await waitForNativeFullscreen(app, true);
   await page.locator(".player-stage").evaluate((stage) => {
      stage.style.animationPlayState = "paused";
   });
   await page.keyboard.press("Escape");
   await expect(page.locator(".player-stage")).toHaveClass(/fullscreen-returning/);
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("window:fullscreen", true));
   await expect(page.locator(".player-stage")).toHaveClass(/fullscreen-returning/);
   await waitForNativeFullscreen(app, false);
   await page.keyboard.press("F11");
   await expect(page.locator(".player-stage")).not.toHaveClass(/fullscreen-returning/);
   await waitForNativeFullscreen(app, true);
   expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
   await page.keyboard.press("Escape");
   await expect(page.locator(".player-stage")).toHaveClass(/fullscreen-returning/);
   await page.emulateMedia({ reducedMotion: "reduce" });
   await expect(page.locator(".player-stage.fullscreen")).toHaveCount(0);
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
   await waitForNativeFullscreen(app, false);
   await page.emulateMedia({ reducedMotion: "no-preference" });
   await page.keyboard.press("F11");
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
   await waitForNativeFullscreen(app, true);
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setFullScreen(false));
   await expect(page.locator(".player-stage.fullscreen")).toHaveCount(0);
});

test("native fullscreen covers the entire display from normal and maximized windows", async ({ launchApp, profile }) => {
   test.skip(process.platform !== "win32", "Windows taskbar and activation ordering");
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0];
      // Exercise real-window activation ordering without taking desktop focus.
      process.env.ATTACUT_HIDDEN = "0";
      window.moveTop = () => {};
      window.focus = () => {
         const bounds = window.getBounds();
         globalThis.fullscreenActivation = { fullscreen: window.isFullScreen(), bounds, display: screen.getDisplayMatching(bounds).bounds };
      };
   });
   for (const maximized of [false, true]) {
      if (maximized) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
      await app.evaluate(() => {
         globalThis.fullscreenActivation = null;
      });
      await page.keyboard.press("F11");
      await expect
         .poll(() =>
            app.evaluate(({ BrowserWindow, screen }) => {
               const window = BrowserWindow.getAllWindows()[0];
               const bounds = window.getBounds();
               return {
                  fullscreen: window.isFullScreen(),
                  coversDisplay: JSON.stringify(bounds) === JSON.stringify(screen.getDisplayMatching(bounds).bounds),
                  alwaysOnTop: window.isAlwaysOnTop(),
               };
            })
         )
         .toEqual({ fullscreen: true, coversDisplay: true, alwaysOnTop: false });
      const activation = await app.evaluate(() => globalThis.fullscreenActivation);
      expect(activation.fullscreen).toBe(true);
      expect(activation.bounds).toEqual(activation.display);
      await page.keyboard.press("Escape");
      await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(maximized);
   }
});
