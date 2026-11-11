import { expect } from "@playwright/test";
import { test, waitForVideo, configureIpc, observeNativeFullscreen, waitForNativeFullscreen } from "./app.mjs";
import { resolve } from "node:path";

test("opening frame export cancels pending playback while a preview is preparing", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
   await configureIpc(app, "source:open", { rememberUrl: true, unsupportedAudio: true });
   await configureIpc(app, "preview:prepare", { before: "preview", previewSuffix: "?prepared=1" });
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mp4"));
   await waitForVideo(page);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("preview"))).toBe(true);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
   await observeNativeFullscreen(app);
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await waitForNativeFullscreen(app, true);
   await expect(page.locator(".fullscreen-controls").getByRole("button", { name: "Pause", exact: true })).toBeVisible();
   await page.keyboard.press("Escape");
   await waitForNativeFullscreen(app, false);
   await expect(page.locator(".player-stage.fullscreen")).toHaveCount(0);
   await page.locator('.toolbar [data-command="frame"]').click();
   await expect(page.getByRole("dialog", { name: "Export frame", exact: true })).toBeVisible();
   await app.evaluate(() => globalThis.attacutTestIpc.release("preview"));
   await expect(page.locator("video")).toHaveAttribute("src", /prepared=1/);
   await waitForVideo(page);
   await expect(page.locator("video")).toHaveJSProperty("paused", true);
   await page.keyboard.press("Escape");
   await expect(page.getByRole("button", { name: "Play", exact: true })).toBeVisible();
});

test("opening shows a skeleton, then permits editing while preview loads", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).first().waitFor();
   // Hold the real probe result so the transient opening state can be inspected reliably.
   await configureIpc(app, "source:open", { after: "opening", patch: { url: "media://source/delayed-preview" } });
   await configureIpc(app, "preview:prepare", { before: "preview" });
   // Hold playback rather than simulating a successful decoded frame. The held preview
   // preparation keeps the load pending, so streamed previews are turned off for this page.
   await page.route("media://source/delayed-preview", () => {});
   await page.evaluate(() => {
      globalThis.MediaSource.isTypeSupported = () => false;
   });
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
