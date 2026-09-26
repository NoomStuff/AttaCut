import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve, basename } from "node:path";
import { readFile, writeFile, readdir } from "node:fs/promises";

test("format playback", async ({ launchApp, profile }) => {
   const formats = JSON.parse(await readFile("work/formats/results.json", "utf8"));
   const files = await readdir("work/formats");
   const application = await launchApp(profile, resolve("work/formats/h264.mp4"));
   const results = [];
   const page = await application.firstWindow();
   await waitForVideo(page);
   for (const format of formats) {
      // Test exports too: these exercise the exact codec joins users will open later.
      const paths = files
         .filter(
            (file) =>
               (file.startsWith(`${format.name}.`) || file.startsWith(`${format.name}-1.25-8.75-cut.`)) &&
               /\.(mp4|mov|mkv|webm|avi|wmv|flv|mpg|ts|mts|m2ts|3gp|3g2|dv|ogv|divx)$/.test(file)
         )
         .map((file) => resolve("work/formats", file));
      expect(paths).toHaveLength(2);
      for (const path of paths) {
         await application.evaluate(({ dialog }, filePath) => {
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
         }, path);
         await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("app:command", "open"));
         const video = page.getByLabel(basename(path), { exact: true });
         await video.waitFor();
         await page.waitForFunction(() => {
            const player = document.querySelector("video");
            return player && (player.readyState >= 2 || player.error);
         });
         await expect(page.getByText(/preparing a playable preview|compatible preview/i)).toHaveCount(0);
         await page.getByRole("button", { name: "Play", exact: true }).click();
         await page.waitForFunction(() => document.querySelector("video")?.currentTime > 0.2, undefined, { timeout: 60000 });
         await page.getByRole("button", { name: "Pause", exact: true }).click();
         expect(await video.evaluate((element) => element.error)).toBeNull();
         expect(await video.evaluate((element) => element.videoWidth)).toBeGreaterThan(0);
         expect(await video.evaluate((element) => element.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);
         if (basename(path) === "transport.ts") {
            await page.getByRole("textbox", { name: "Clip start", exact: true }).fill("00:01.25");
            await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
            await page.getByRole("button", { name: "Export", exact: true }).click();
            await expect(page.getByRole("button", { name: "Export video", exact: true })).toBeEnabled();
            await page.keyboard.press("Escape");
         }
         results.push({ name: basename(path), playback: "ready" });
         console.log("PASS", basename(path));
      }
   }
   await writeFile("work/formats/playback-results.json", JSON.stringify(results, null, 2));
});
