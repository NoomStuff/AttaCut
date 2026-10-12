import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("autoplay applies to opened videos but leaves restored sessions paused", async ({ launchApp, profile }) => {
   let app = await launchApp(profile, resolve("work/fixture.mp4"));
   let page = await app.firstWindow();
   await waitForVideo(page);
   await expect.poll(() => page.locator("video").evaluate((video) => video.paused)).toBe(true);

   const setAutoPlay = async (enabled) => {
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await page.getByRole("tab", { name: "Editing" }).click();
      await page.getByRole("switch", { name: "Autoplay opened videos", exact: true }).setChecked(enabled);
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "detached" });
   };
   const open = async (name) => {
      await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), resolve(`work/${name}`));
      await expect(page.locator(".title-filename")).toHaveText(name);
      await waitForVideo(page);
   };
   const playing = () =>
      page.waitForFunction(() => {
         const video = document.querySelector("video");
         return video && !video.paused && video.currentTime > 0.2;
      });

   await setAutoPlay(true);
   await open("fixture.mkv");
   await playing();
   await app.close();

   app = await launchApp(profile, "");
   page = await app.firstWindow();
   await waitForVideo(page);
   await expect.poll(() => page.locator("video").evaluate((video) => video.paused)).toBe(true);
   await app.close();

   app = await launchApp(profile, resolve("work/fixture.mp4"));
   page = await app.firstWindow();
   await waitForVideo(page);
   await playing();
   await setAutoPlay(false);
   await open("fixture.mp4");
   await expect.poll(() => page.locator("video").evaluate((video) => video.paused)).toBe(true);
});
