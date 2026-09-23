/* global window, KeyboardEvent */
import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
// Prefer the packaged binary when it has been bundled; fall back to PATH for dev runs.

test("timeline", async ({ launchApp, profile }) => {
   const ffmpeg =
      process.env.FFMPEG_PATH ??
      (existsSync(resolve("resources/media", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"))
         ? resolve("resources/media", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
         : "ffmpeg");
   for (const audio of [true, false]) {
      execFileSync(ffmpeg, [
         "-v",
         "error",
         "-i",
         resolve("work/named-audio.mp4"),
         "-map",
         "0:v:0",
         ...(audio ? ["-map", "0:a:0"] : []),
         "-c",
         "copy",
         resolve(profile, audio ? "single.mp4" : "silent.mp4"),
      ]);
   }
   const app = await launchApp(profile, resolve("work/named-audio.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   const bar = await page.locator(".timeline-viewport").boundingBox();
   const seek = async (time) => {
      if (time === 18) {
         await page.mouse.move(bar.x + bar.width - 30, bar.y + 36);
         await page.mouse.down();
         await page.mouse.move(bar.x + bar.width + 5, bar.y + 36, { steps: 3 });
         await page.mouse.up();
      } else {
         await page.mouse.click(bar.x + (bar.width * time) / 18, bar.y + 36);
      }
      await page.waitForFunction((time) => Math.abs(document.querySelector("video").currentTime - time) < 0.05, time);
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
   await page.getByRole("button", { name: "Zoom in", exact: true }).click();
   await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText("125%");
   await expect(page.getByRole("slider", { name: "Pan timeline", exact: true })).toHaveCount(0);
   for (const percent of [150, 200, 250, 300, 400, 500, 600, 800, 1000]) {
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      await expect(page.getByRole("button", { name: "Fit timeline", exact: true })).toHaveText(`${percent}%`);
   }
   await page.getByRole("button", { name: "Fit timeline", exact: true }).click();
   await page.getByRole("button", { name: "Zoom in", exact: true }).click();
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
   await seek(18);
   await expect(page.locator(".player-excluded")).toHaveClass(/hidden/);
   await end.fill("00:17.00");
   await end.press("Tab");
   await seek(18);
   await expect(page.locator(".player-excluded")).not.toHaveClass(/hidden/);
   await page.getByRole("button", { name: "Playback settings", exact: true }).click();
   await page.getByRole("switch", { name: "Keep playing while editing", exact: true }).uncheck();
   await page.keyboard.press("Escape");
   await seek(4);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await seek(8);
   await expect(video).toHaveJSProperty("paused", true);
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560));
   const full = await page.getByRole("button", { name: "Fullscreen video", exact: true }).boundingBox();
   expect(full.x + full.width).toBeLessThanOrEqual(800);
   for (const audio of [true, false]) {
      await app.evaluate(
         ({ dialog, BrowserWindow }, path) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
            BrowserWindow.getAllWindows()[0].webContents.send("app:command", "open");
         },
         resolve(profile, audio ? "single.mp4" : "silent.mp4")
      );
      await expect(page.locator(".title-filename")).toHaveText(audio ? "single.mp4" : "silent.mp4");
      const selector = page.getByRole("button", { name: "Preview audio tracks", exact: true });
      await expect(selector).toHaveCount(0);
      await page.getByRole("button", { name: "Export", exact: true }).click();
      const exportAudio = page.getByRole("switch", { name: "Export audio", exact: true });
      if (audio) await expect(exportAudio).toBeChecked();
      else await expect(exportAudio).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Audio tracks to export", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
   }
   console.log(
      "PASS playback preservation/default pause, unchanged time fields, named tracks, zoom %, fit, middle/Alt/arrows pan, edge fades, shortcut focus, end inclusion, compact controls"
   );
});
