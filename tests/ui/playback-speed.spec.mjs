import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("preview speed survives seeking and fullscreen, then resets for a new source", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   const picker = page.locator(".transport").getByRole("button", { name: "Playback speed", exact: true });
   await picker.click();
   await page.screenshot({ path: "work/speed-wide.png" });
   await page.keyboard.press("Escape");
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(850, 650));
   await picker.click();
   await page.screenshot({ path: "work/speed-narrow.png" });
   await expect
      .poll(() =>
         page
            .locator(".transport")
            .evaluate((element) => element.querySelector(".volume-controls").getBoundingClientRect().right - element.getBoundingClientRect().right)
      )
      .toBeLessThanOrEqual(0);

   await page.getByRole("option", { name: "0.5\u00d7", exact: true }).click();
   await expect(video).toHaveJSProperty("playbackRate", 0.5);
   await expect(video).toHaveJSProperty("preservesPitch", true);
   await page.keyboard.press("ArrowRight");
   await expect(video).toHaveJSProperty("playbackRate", 0.5);
   await page.keyboard.press("]");
   await expect(video).toHaveJSProperty("playbackRate", 0.75);
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await page.locator(".fullscreen-controls").getByRole("button", { name: "Playback speed", exact: true }).click();
   await page.getByRole("option", { name: "2\u00d7", exact: true }).click();
   await expect(video).toHaveJSProperty("playbackRate", 2);
   await expect(video).toHaveJSProperty("preservesPitch", true);
   await page.keyboard.press("Escape");
   await expect(picker).toHaveText(/2/);
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve("work/fixture.mkv"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await waitForVideo(page);
   await expect(video).toHaveJSProperty("playbackRate", 1);
});
