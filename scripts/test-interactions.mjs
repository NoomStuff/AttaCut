import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
const profile = await mkdtemp(resolve("work/interactions-"));
const output = join(profile, "exports");
await mkdir(output);
const app = await electron.launch({
   args: process.env.ATTACUT_EXECUTABLE ? [] : ["."],
   ...(process.env.ATTACUT_EXECUTABLE ? { executablePath: process.env.ATTACUT_EXECUTABLE } : {}),
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
try {
   const page = await app.firstWindow();
   page.setDefaultTimeout(15000);
   const errors = [];
   page.on("pageerror", (error) => errors.push(error.message));
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await page.waitForFunction(() => document.fullscreenElement?.tagName === "VIDEO");
   await page.evaluate(() => document.exitFullscreen());
   await page.waitForFunction(() => !document.fullscreenElement);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByRole("textbox", { name: "Combined filename", exact: true })).toHaveValue("fixture (Trim)");
   await expect(page.getByRole("button", { name: "Separate clips", exact: true })).toBeDisabled();
   await expect(page.getByRole("button", { name: "Export video", exact: true })).toBeEnabled();
   await expect(page.getByRole("textbox", { name: "Clip 1 filename", exact: true })).toHaveCount(0);
   await page.keyboard.press("Escape");
   await page.getByRole("button", { name: "Snap to keyframes", exact: true }).click();
   await expect(page.locator("[data-command=split]")).toBeDisabled();
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + (bar.width * 5.3) / 18, bar.y + 36);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveAttribute("aria-valuenow", "6");
   await page.waitForFunction(() => document.querySelector("video").currentTime === 6);
   await page.getByRole("button", { name: "Zoom in", exact: true }).click();
   await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("125%");
   await page.keyboard.press("f");
   await page.getByRole("button", { name: "Export", exact: true }).click();
   const modal = page.getByRole("dialog", { name: "Export clips", exact: true });
   await modal.evaluate((dialog) => Promise.all(dialog.getAnimations().map((animation) => animation.finished)));
   const before = await modal.boundingBox();
   await page.getByRole("button", { name: "Merged Video", exact: true }).click();
   const after = await modal.boundingBox();
   expect(after.y).toBeCloseTo(before.y, 0);
   expect(after.height).toBeCloseTo(before.height, 0);
   await page.getByRole("textbox", { name: "Save to", exact: true }).fill(output);
   await page.getByRole("textbox", { name: "Combined filename", exact: true }).fill("joined");
   await page.screenshot({ path: "work/screenshots/v04-export.png" });
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await page.getByText("1 clip exported", { exact: true }).waitFor({ timeout: 60000 });
   await page.getByRole("button", { name: "Dismiss export status", exact: true }).click();
   const media = process.env.ATTACUT_MEDIA_FILE ?? resolve("work/fixture.mp4");
   await app.evaluate(({ dialog, BrowserWindow }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      BrowserWindow.getAllWindows()[0].webContents.send("app:command", "open");
   }, media);
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveCount(0);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByRole("textbox", { name: "Save to", exact: true })).toHaveValue(dirname(media));
   await page.keyboard.press("Escape");
   await page.locator("video").evaluate((video) => {
      globalThis.presented = [];
      const frame = (now) => {
         globalThis.presented.push(now);
         video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
   });
   const timeline = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.move(timeline.x + timeline.width * 0.1, timeline.y + 36);
   await page.mouse.down();
   for (let i = 0; i < 90; i++) {
      await page.mouse.move(timeline.x + timeline.width * (0.1 + (0.7 * i) / 89), timeline.y + 36);
      await new Promise((resolve) => setTimeout(resolve, 33));
   }
   await page.mouse.up();
   await page.waitForFunction(() => {
      const video = document.querySelector("video");
      return !video.seeking && Math.abs(video.currentTime - video.duration * 0.8) < 0.05;
   });
   const times = await page.evaluate(() => globalThis.presented);
   expect(times.length).toBeGreaterThan(8);
   const gaps = times.slice(1).map((time, i) => time - times[i]);
   console.log(`Scrubbing presented ${times.length} frames; largest gap ${Math.max(...gaps).toFixed(0)}ms`);
   expect(Math.max(...gaps)).toBeLessThan(1000);
   await page.screenshot({ path: "work/screenshots/v04-editor.png" });
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560));
   await page.screenshot({ path: "work/screenshots/v04-small.png" });
   const full = await page.getByRole("button", { name: "Fullscreen video", exact: true }).boundingBox();
   expect(full.x + full.width).toBeLessThanOrEqual(800);
   expect(errors).toEqual([]);
   console.log("PASS fullscreen, snapped split, zoom, stable export, source-folder reset, decoded scrubbing and compact controls");
} catch (error) {
   await (await app.firstWindow()).screenshot({ path: "work/screenshots/v04-failure.png" });
   throw error;
} finally {
   await app.close();
}
