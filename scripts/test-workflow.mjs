import { _electron as electron, expect } from "@playwright/test";
import { resolve, join } from "node:path";
import { mkdtemp, mkdir, readdir } from "node:fs/promises";
const profile = await mkdtemp(resolve("work/workflow-profile-"));
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
   await expect(page.locator(".source-info,.statusbar,.timeline-heading,.playback-time,.hover-time")).toHaveCount(0);
   expect((await page.locator(".editor-dock").boundingBox()).height).toBeLessThan(130);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.move(bar.x + bar.width * 0.1, bar.y + 36);
   await page.mouse.down();
   await page.mouse.move(bar.x + bar.width * 0.4, bar.y + 36, { steps: 12 });
   await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 7.2) < 0.05);
   await page.mouse.up();
   await page.keyboard.press("s");
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   const end = page.getByRole("textbox", { name: "Clip end", exact: true });
   await start.fill("00:09.00");
   await start.press("Tab");
   await end.fill("00:16.00");
   await end.press("Tab");
   await page.locator("video").evaluate((v) => {
      v.currentTime = 12;
   });
   await page.waitForFunction(() => document.querySelector("video").currentTime === 12);
   await page.getByRole("button", { name: "Previous clip", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime === 9);
   await page.getByRole("button", { name: "Previous clip", exact: true }).click();
   await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 7.2) < 0.05);
   await page.getByRole("button", { name: "Next clip", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime === 9);
   const originalUrl = await page.locator("video").getAttribute("src");
   await page.getByRole("button", { name: "Preview audio tracks", exact: true }).click();
   await page.screenshot({ path: "work/screenshots/audio-menu.png" });
   await page.getByRole("option").nth(1).click();
   await page.getByRole("option").nth(0).click();
   await expect(page.getByText(/preparing a playable preview|compatible preview/i)).toHaveCount(0);
   await expect(page.locator("video")).not.toHaveAttribute("src", originalUrl);
   await page.getByRole("button", { name: "Snap to keyframes", exact: true }).click();
   await expect(page.getByRole("button", { name: "Snap to keyframes", exact: true })).toHaveAttribute("aria-pressed", "true");
   expect(await page.locator(".keyframe-tick").count()).toBeGreaterThan(0);
   const handle = page.getByRole("slider", { name: "Clip 2 start", exact: true });
   const rect = await handle.boundingBox();
   await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
   await page.mouse.down();
   await page.mouse.move(bar.x + (bar.width * 10.8) / 18, bar.y + 36, { steps: 8 });
   await page.mouse.up();
   await expect(handle).toHaveAttribute("aria-valuenow", "10");
   await page.screenshot({ path: "work/screenshots/compact-editor.png" });
   await page.getByRole("button", { name: "Export current frame", exact: true }).click();
   await page.getByRole("dialog", { name: "Export current frame", exact: true }).waitFor();
   expect(await page.getByRole("button", { name: "Close panel" }).evaluate((button) => button === document.activeElement)).toBe(false);
   await page.getByRole("textbox", { name: "Save frame to", exact: true }).fill(output);
   await page.getByRole("textbox", { name: "Frame filename", exact: true }).fill("test-frame");
   await page.screenshot({ path: "work/screenshots/frame-export.png" });
   await page.getByRole("button", { name: "Export frame", exact: true }).click();
   await page.getByRole("status").filter({ hasText: "Frame exported" }).waitFor();
   expect(await readdir(output)).toContain("test-frame.png");
   await page.keyboard.press("Escape");
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("button", { name: "Merged Video", exact: true }).click();
   await page.getByLabel("Save to", { exact: true }).fill(output);
   await page.getByRole("textbox", { name: "Combined filename", exact: true }).fill("joined");
   await expect(page.getByRole("button", { name: "Audio tracks to export", exact: true })).toContainText("All audio tracks");
   await expect(page.getByRole("button", { name: "Export video", exact: true })).toBeEnabled();
   await expect(page.getByText("Cut details", { exact: true })).toHaveCount(0);
   await page.screenshot({ path: "work/screenshots/compact-export.png" });
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await page.getByText("Export complete", { exact: true }).waitFor({ timeout: 60000 });
   expect(await readdir(output)).toContain("joined.mp4");
   await page.getByRole("button", { name: "Dismiss export status", exact: true }).click();
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560));
   await page.screenshot({ path: "work/screenshots/compact-small.png" });
   const controls = await page.locator(".transport").boundingBox();
   expect(controls.y + controls.height).toBeLessThanOrEqual(560);
   const volume = await page.getByRole("button", { name: "Playback settings", exact: true }).boundingBox();
   expect(volume.x + volume.width).toBeLessThanOrEqual(800);
   if (process.env.ATTACUT_MEDIA_FILE) {
      await app.evaluate(({ dialog }, filePath) => {
         dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
      }, process.env.ATTACUT_MEDIA_FILE);
      await app.evaluate(({ BrowserWindow }) => {
         const window = BrowserWindow.getAllWindows()[0];
         window.setSize(1360, 880);
         window.webContents.send("app:command", "open");
      });
      await page.waitForFunction(() => document.querySelector("video")?.audioTracks?.length === 5);
      for (let index = 0; index < 5; index++) {
         await page.getByRole("button", { name: "Preview audio tracks", exact: true }).click();
         const started = Date.now();
         await page.getByRole("option").nth(index).click();
         console.log(`OBS track ${index + 1} toggled in ${Date.now() - started}ms`);
      }
      await page.locator("video").evaluate(async (video) => {
         video.currentTime = 30;
         await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
         video.muted = true;
         await video.play();
      });
      await page.waitForFunction(() => document.querySelector("video").currentTime > 30.2);
      await page.locator("video").evaluate((video) => video.pause());
      await page.screenshot({ path: "work/screenshots/obs-editor.png" });
   }
   expect(errors).toEqual([]);
   console.log("PASS compact UI, scrubbing, boundary navigation, multi-track audio, snapping, frame export, merged export, and 800x560 layout");
} finally {
   await app.close();
}
