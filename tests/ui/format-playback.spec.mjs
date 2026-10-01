import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { basename } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const formats = existsSync("work/formats/results.json") ? JSON.parse(readFileSync("work/formats/results.json", "utf8")) : [];
test("format manifest is present and contains successful fixtures", async () => {
   expect(formats.length, "Run bun run test:media before playback checks").toBeGreaterThan(0);
   expect(formats.every((format) => format.passed && format.source && format.output)).toBe(true);
});
for (const format of formats) {
   test(`format playback: ${format.name}`, async ({ launchApp, profile }) => {
      test.setTimeout(120000);
      expect(format.passed).toBe(true);
      const paths = [format.source, format.output];
      expect(paths.every((path) => path && existsSync(path))).toBe(true);
      const application = await launchApp(profile, paths[0]);
      const page = await application.firstWindow();
      await waitForVideo(page);
      for (const [index, path] of paths.entries()) {
         if (index > 0) {
            await application.evaluate(({ dialog }, filePath) => {
               dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
            }, path);
            await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send("app:command", "open"));
         }
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
         console.log("PASS", basename(path));
      }
   });
}
