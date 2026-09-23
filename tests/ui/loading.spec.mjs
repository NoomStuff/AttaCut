import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("opening shows a skeleton, then permits editing while preview loads", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Import video", exact: true }).first().waitFor();
   // Hold the real probe result so the transient opening state can be inspected reliably.
   await app.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get("source:open");
      ipcMain.removeHandler("source:open");
      ipcMain.handle("source:open", async (...args) => {
         const result = await original(...args);
         await new Promise((resolve) => {
            globalThis.finishOpening = resolve;
         });
         return { ...result, url: "media://source/delayed-preview" };
      });
      globalThis.keyframeRequests = 0;
      const keys = ipcMain._invokeHandlers.get("source:keyframes");
      ipcMain.removeHandler("source:keyframes");
      ipcMain.handle("source:keyframes", (...args) => {
         globalThis.keyframeRequests++;
         return keys(...args);
      });
   });
   // Hold playback rather than simulating a successful decoded frame.
   await page.route("media://source/delayed-preview", () => {});
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mp4"));
   await expect(page.getByRole("status", { name: "Opening video", exact: true })).toBeVisible();
   await page.screenshot({ path: "test-results/loading-source.png" });
   await expect.poll(() => app.evaluate(() => typeof globalThis.finishOpening)).toBe("function");
   await app.evaluate(() => globalThis.finishOpening());
   await expect(page.locator(".preview-loading")).toBeVisible();
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("00:01.00");
   await start.press("Tab");
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "1");
   expect(await app.evaluate(() => globalThis.keyframeRequests)).toBe(0);
   await page.screenshot({ path: "test-results/loading-preview.png" });
   await page.getByRole("button", { name: "Snap to keyframes", exact: true }).click();
   await expect.poll(() => app.evaluate(() => globalThis.keyframeRequests)).toBe(1);
   await page.unrouteAll({ behavior: "ignoreErrors" });
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
            expect.stringMatching(/ExportPanel-.*\.js$/),
            expect.stringMatching(/SettingsPanel-.*\.js$/),
            expect.stringMatching(/FramePanel-.*\.js$/),
            expect.stringMatching(/HelpPanel-.*\.js$/),
            expect.stringMatching(/AboutPanel-.*\.js$/),
         ])
      );
   await debuggerSession.detach();
   expect(await page.locator("dialog[open]").count()).toBe(0);
   await app.evaluate(({ ipcMain }) => {
      globalThis.keyframeRequests = 0;
      globalThis.keysReady = false;
      const original = ipcMain._invokeHandlers.get("source:keyframes");
      ipcMain.removeHandler("source:keyframes");
      ipcMain.handle("source:keyframes", async (...args) => {
         globalThis.keyframeRequests++;
         const keys = await original(...args);
         globalThis.keysReady = true;
         return keys;
      });
   });
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mp4"));
   await waitForVideo(page);
   const snap = page.getByRole("button", { name: "Snap to keyframes", exact: true });
   await expect(snap).toHaveAttribute("aria-pressed", "false");
   await expect.poll(() => app.evaluate(() => globalThis.keysReady)).toBe(true);
   await snap.click();
   await expect(snap).toHaveAttribute("aria-pressed", "true");
   await expect(snap).toHaveAttribute("aria-busy", "false");
   expect(await app.evaluate(() => globalThis.keyframeRequests)).toBe(1);
});
