import { expect } from "@playwright/test";
import { mediaBinary, test, waitForPlaybackTime, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

test("opening constrained export dialogs preserves preferences and explicit audio choices survive restart", async ({ launchApp, profile }) => {
   const single = resolve(profile, "single.mp4");
   const silent = resolve(profile, "silent.mp4");
   const ffmpeg = mediaBinary("ffmpeg");
   for (const [path, audio] of [
      [single, true],
      [silent, false],
   ]) {
      execFileSync(ffmpeg, ["-v", "error", "-i", resolve("work/fixture.mp4"), "-map", "0:V:0", ...(audio ? ["-map", "0:a:0"] : []), "-c", "copy", path], {
         windowsHide: true,
      });
   }
   let app = await launchApp(profile, single);
   let page = await app.firstWindow();
   await waitForVideo(page);
   for (const path of [single, silent]) {
      if (path === silent) {
         await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
         await expect(page.locator("video")).toHaveAttribute("aria-label", "silent.mp4");
         await waitForVideo(page);
      }
      await expect(page.getByRole("button", { name: "Preview audio tracks", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const preferences = await page.evaluate(async () => (await globalThis.desktop.bootstrap()).preferences);
      expect(preferences.exportMode).toBe("separate");
      expect(preferences.exportAudio).toEqual({ mode: "default", sourceTrackCount: 0, tracks: [] });
      await page.keyboard.press("Escape");
   }
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), single);
   await expect(page.locator("video")).toHaveAttribute("aria-label", "single.mp4");
   await waitForVideo(page);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("switch", { name: "Export audio", exact: true }).uncheck();
   await page.keyboard.press("Escape");
   await expect(page.getByRole("button", { name: "Export video", exact: true })).toBeHidden();
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(viewport.x + viewport.width / 3, viewport.y + 36);
   await waitForPlaybackTime(page, 6);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByRole("button", { name: "Separate Clips", exact: true })).toHaveAttribute("aria-pressed", "true");
   await page.keyboard.press("Escape");
   await app.close();
   app = await launchApp(profile, resolve("work/fixture.mp4"));
   page = await app.firstWindow();
   await waitForVideo(page);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByRole("button", { name: "Audio tracks to export", exact: true })).toContainText("0 audio tracks");
});

test("seam merge targeting and handle seeking", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + bar.width / 3, bar.y + 36);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   await page.mouse.click(bar.x + bar.width * 0.8, bar.y + 36);
   await expect(page.locator("[data-command=merge]")).toBeDisabled();
   await expect(page.locator("[data-command=split]")).toBeEnabled();
   const handle = page.getByRole("slider", { name: "Clip 1 end", exact: true });
   const target = Number(await handle.getAttribute("aria-valuenow"));
   await handle.click();
   await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeCloseTo(target - 1 / 30, 2);
   console.log("Handle click seeks correctly:", target);
   // Nearby positions remain valid splits; merge belongs to the shared cut itself.
   await page.mouse.click(bar.x + (bar.width * target) / 18 + 10, bar.y + 12);
   await expect(page.locator("[data-command=merge]")).toBeDisabled();
   await expect(page.locator("[data-command=split]")).toBeEnabled();
   await page.mouse.click(bar.x + (bar.width * target) / 18, bar.y + 12);
   await expect(page.locator("[data-command=merge]")).toBeEnabled();
   await expect(page.locator("[data-command=split]")).toBeDisabled();
   await page.locator("[data-command=merge]").click();
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1);
   await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeCloseTo(target, 2);
   await expect(page.locator("[data-command=split]")).toBeEnabled();
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveAttribute("aria-valuenow", String(target));
});

test("export names, selection and destination confirmations persist", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + bar.width / 3, bar.y + 36);
   await waitForPlaybackTime(page, 6);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("button", { name: "Single Video", exact: true }).click();
   await page.getByLabel("Combined filename", { exact: true }).fill("retained");
   await page.getByLabel("Save to", { exact: true }).fill(profile + "/new-folder");
   await page.getByRole("button", { name: "Audio tracks to export", exact: true }).click();
   await page.getByRole("option").last().click();
   await expect(page.getByRole("button", { name: "Audio tracks to export", exact: true })).not.toContainText("All audio tracks");
   await page.getByRole("button", { name: "Close panel", exact: true }).last().click();
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByLabel("Combined filename", { exact: true })).toHaveValue("retained");
   await expect(page.getByRole("button", { name: "Audio tracks to export", exact: true })).not.toContainText("All audio tracks");
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await expect(page.getByRole("dialog", { name: "Create output folder?", exact: true })).toBeVisible();
   await page.waitForTimeout(200);
   await page.getByRole("button", { name: "Cancel", exact: true }).click();
   await expect(page.getByRole("dialog", { name: "Export video", exact: true })).toBeVisible();
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await page.getByRole("button", { name: "Create folder and export", exact: true }).click();
   await expect(page.getByRole("button", { name: "Open file", exact: true })).toBeVisible({ timeout: 60000 });
   await page.getByRole("button", { name: "Export", exact: true }).click();
   const conflict = page.getByRole("img", { name: "Will replace an existing file" });
   await expect(conflict).toBeVisible();
   await expect(conflict.locator(".export-conflict-tooltip")).toBeHidden();
   await conflict.hover();
   await expect(conflict.locator(".export-conflict-tooltip")).toBeVisible();
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await expect(page.getByRole("dialog", { name: "Replace existing file?", exact: true })).toBeVisible();
   await page.waitForTimeout(200);
   await page.getByRole("button", { name: "Replace and export", exact: true }).click();
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await expect(page.getByRole("button", { name: "Open file", exact: true })).toBeVisible({ timeout: 60000 });
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("button", { name: "Separate Clips", exact: true }).click();
   await page.getByRole("textbox", { name: "Clip 1 filename", exact: true }).fill("first-kept-name");
   await page.getByRole("checkbox", { name: "Export clip 2", exact: true }).uncheck();
   await page.keyboard.press("Escape");
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByRole("button", { name: "Separate Clips", exact: true })).toHaveAttribute("aria-pressed", "true");
   await expect(page.getByRole("textbox", { name: "Clip 1 filename", exact: true })).toHaveValue("first-kept-name");
   await expect(page.getByRole("checkbox", { name: "Export clip 2", exact: true })).not.toBeChecked();
   console.log("Export persistence, missing folder, cancel and overwrite passed");
});

test("duplicate clip names block the export instead of being rewritten", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(viewport.x + viewport.width / 2, viewport.y + 36);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   await page.getByRole("button", { name: "Export", exact: true }).click();
   const dialog = page.getByRole("dialog", { name: "Export clips" });
   await dialog.waitFor();
   await expect(dialog.getByRole("button", { name: "Export 2 clips" })).toBeEnabled();
   const first = dialog.getByRole("textbox", { name: "Clip 1 filename", exact: true });
   const second = dialog.getByRole("textbox", { name: "Clip 2 filename", exact: true });
   await first.fill("same-name");
   await second.fill("same-name");
   // Both rows turn dangerous and the export locks; nothing is renamed behind the user's back.
   await expect(dialog.getByRole("img", { name: "Another clip exports to this name" })).toHaveCount(2);
   await expect(dialog.getByText("Some clips export to the same file name")).toBeVisible();
   await expect(dialog.getByRole("button", { name: "Export 2 clips" })).toBeDisabled();
   // File systems compare case-insensitively, so this still collides.
   await second.fill("Same-Name");
   await expect(dialog.getByRole("button", { name: "Export 2 clips" })).toBeDisabled();
   await second.fill("other-name");
   await expect(dialog.getByRole("img", { name: "Another clip exports to this name" })).toHaveCount(0);
   await expect(dialog.getByRole("button", { name: "Export 2 clips" })).toBeEnabled();
   // Clearing a field stays empty while typing; leaving it empty hands the name back to
   // the template on blur.
   await first.fill("");
   await expect(first).toHaveValue("");
   await expect(first).toBeFocused();
   await first.press("Tab");
   await expect(first).toHaveValue("fixture (1)");
   await expect(dialog.getByRole("button", { name: "Export 2 clips" })).toBeEnabled();
});
