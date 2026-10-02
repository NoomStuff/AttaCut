import { expect } from "@playwright/test";
import { test, waitForVideo, configureIpc } from "./app.mjs";
import { resolve } from "node:path";

test("opening shows a skeleton, then permits editing while preview loads", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).first().waitFor();
   // Hold the real probe result so the transient opening state can be inspected reliably.
   await configureIpc(app, "source:open", { after: "opening", patch: { url: "media://source/delayed-preview" } });
   await configureIpc(app, "preview:prepare", { before: "preview" });
   // Hold playback rather than simulating a successful decoded frame.
   await page.route("media://source/delayed-preview", () => {});
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mp4"));
   await expect(page.getByRole("status", { name: "Opening video", exact: true })).toBeVisible();
   await expect(page.locator(".loading-editor-transport .play-button")).toBeVisible();
   await page.screenshot({ path: "test-results/loading-source.png" });
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("opening"))).toBe(true);
   await app.evaluate(() => globalThis.attacutTestIpc.release("opening"));
   await expect(page.locator(".player-stage video")).toBeVisible();
   await expect(page.locator(".player-stage.pending")).toBeVisible();
   await page.waitForTimeout(1200);
   await expect(page.locator(".preview-loading .spinner")).toHaveCount(0);
   await page.evaluate(() => {
      globalThis.previewTimes = { seek: 0, indicator: 0 };
      document.querySelector(".timeline-viewport").addEventListener(
         "pointerdown",
         () => {
            globalThis.previewTimes.seek = globalThis.performance.now();
         },
         { once: true }
      );
      const observer = new globalThis.MutationObserver(() => {
         if (document.querySelector(".preview-loading .spinner")) {
            globalThis.previewTimes.indicator = globalThis.performance.now();
            observer.disconnect();
         }
      });
      observer.observe(document.body, { childList: true, subtree: true });
   });
   await page.locator(".timeline-viewport").click({ position: { x: 180, y: 20 } });
   await expect(page.locator(".preview-loading .spinner")).toBeVisible();
   await expect(page.locator(".preview-loading.delayed")).toContainText("Loading frame...");
   expect(await page.evaluate(() => globalThis.previewTimes.indicator - globalThis.previewTimes.seek)).toBeGreaterThanOrEqual(900);
   await expect(page.locator(".preview-loading.delayed")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
   await page.screenshot({ path: "test-results/loading-preview.png" });
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("00:01.00");
   await start.press("Tab");
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "1");
   expect(await app.evaluate(() => globalThis.attacutTestIpc.count("source:keyframes"))).toBe(0);
   await page.getByRole("button", { name: "Snap to keyframes", exact: true }).click();
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.count("source:keyframes"))).toBe(1);
   await app.evaluate(() => globalThis.attacutTestIpc.release("preview"));
   await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a stalled seek keeps the decoded preview visible through both fades", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mp4"));
   await waitForVideo(page);
   await expect(page.locator(".player-stage video.frame-ready")).toBeVisible();
   await configureIpc(app, "source:frame-time", { before: "frame" });
   await page.locator(".timeline-viewport").click({ position: { x: 180, y: 20 } });
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("frame"))).toBe(true);
   const status = page.locator(".preview-loading.delayed");
   await expect(status).toBeVisible();
   await expect(status).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
   await expect(page.locator(".player-stage video")).toBeVisible();
   await expect.poll(() => status.evaluate((element) => Number(globalThis.getComputedStyle(element).opacity))).toBeGreaterThan(0.15);
   await page.screenshot({ path: "test-results/loading-seek-overlay.png" });
   await page.evaluate(() => {
      const indicator = document.querySelector(".preview-loading.delayed");
      const observer = new globalThis.MutationObserver(() => {
         if (!indicator.classList.contains("closing")) return;
         const start = Number(globalThis.getComputedStyle(indicator).opacity);
         globalThis.requestAnimationFrame(() => {
            globalThis.fadeOutOpacities = { start, next: Number(globalThis.getComputedStyle(indicator).opacity) };
         });
         observer.disconnect();
      });
      observer.observe(indicator, { attributes: true, attributeFilter: ["class"] });
   });
   await app.evaluate(() => globalThis.attacutTestIpc.release("frame"));
   await expect.poll(() => page.evaluate(() => globalThis.fadeOutOpacities)).toBeTruthy();
   const fade = await page.evaluate(() => globalThis.fadeOutOpacities);
   // The indicator may finish fading in before the runner releases the held seek.
   expect(fade.start).toBeGreaterThan(0);
   expect(fade.start).toBeLessThanOrEqual(1);
   expect(fade.next).toBeLessThanOrEqual(fade.start);
   await expect(status).toHaveCount(0);
});

test("a prepared preview replaces the source frame without a blank flash", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
   await configureIpc(app, "source:open", { rememberUrl: true, unsupportedAudio: true });
   await configureIpc(app, "preview:prepare", { before: "preview", previewSuffix: "?preview=1" });
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mp4"));
   await waitForVideo(page);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("preview"))).toBe(true);
   await expect(page.locator(".player-stage.pending")).toHaveCount(0);
   await page.locator(".timeline-viewport").click({ position: { x: 400, y: 20 } });
   await page.waitForFunction(() => {
      const video = document.querySelector(".player-stage video");
      return video.currentTime > 2 && !video.seeking && video.readyState >= 2;
   });
   const timeBeforeSwap = await page.locator(".player-stage video").evaluate((video) => video.currentTime);
   await page.evaluate(() => {
      const video = document.querySelector(".player-stage video");
      const observer = new globalThis.MutationObserver(() => {
         if (!video.getAttribute("src")?.includes("?preview=1")) return;
         const canvas = document.querySelector(".preview-held-frame");
         globalThis.previewSwapState = {
            held: canvas.classList.contains("visible"),
            width: canvas.width,
            skeleton: !!document.querySelector(".player-stage.pending"),
         };
         observer.disconnect();
      });
      observer.observe(video, { attributes: true, attributeFilter: ["src"] });
   });
   await app.evaluate(() => globalThis.attacutTestIpc.release("preview"));
   await expect.poll(() => page.evaluate(() => globalThis.previewSwapState)).toBeTruthy();
   expect(await page.evaluate(() => globalThis.previewSwapState)).toMatchObject({ held: true, skeleton: false });
   const held = page.locator(".preview-held-frame");
   expect((await page.evaluate(() => globalThis.previewSwapState)).width).toBeGreaterThan(0);
   await expect(held).not.toHaveClass(/visible/);
   await expect(page.locator(".player-stage video.frame-ready.no-fade")).toBeVisible();
   await expect(page.locator(".player-stage.pending")).toHaveCount(0);
   expect(await page.locator(".player-stage video").evaluate((video) => video.currentTime)).toBeCloseTo(timeBeforeSwap, 1);
});

test("idle time warms dialogs and keyframes before they are requested", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   // Electron's custom protocol does not report Resource Timing entries.
   const debuggerSession = await page.context().newCDPSession(page);
   const scripts = [];
   debuggerSession.on("Debugger.scriptParsed", ({ url }) => scripts.push(url));
   await debuggerSession.send("Debugger.enable");
   await expect
      .poll(() => scripts)
      .toEqual(
         expect.arrayContaining([
            expect.stringMatching(/SettingsPanel-.*\.js$/),
            expect.stringMatching(/FramePanel-.*\.js$/),
            expect.stringMatching(/HelpPanel-.*\.js$/),
            expect.stringMatching(/AboutPanel-.*\.js$/),
         ])
      );
   expect(await page.locator("dialog[open]").count()).toBe(0);
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mp4"));
   await waitForVideo(page);
   // The export panel loads eagerly with the source so opening Export never shows a loader.
   await expect.poll(() => scripts).toEqual(expect.arrayContaining([expect.stringMatching(/ExportPanel-.*\.js$/)]));
   await debuggerSession.detach();
   const snap = page.getByRole("button", { name: "Snap to keyframes", exact: true });
   await expect(snap).toHaveAttribute("aria-pressed", "false");
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.ready("source:keyframes"))).toBe(true);
   await snap.click();
   await expect(snap).toHaveAttribute("aria-pressed", "true");
   await expect(snap).toHaveAttribute("aria-busy", "false");
   expect(await app.evaluate(() => globalThis.attacutTestIpc.count("source:keyframes"))).toBe(1);
});
