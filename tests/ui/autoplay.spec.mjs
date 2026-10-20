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
      await page.getByRole("tab", { name: "General" }).click();
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

test("picture clicks and Space toggle playback after an external open", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   await video.click();
   await expect(video).toHaveJSProperty("paused", false);
   await video.click();
   await expect(video).toHaveJSProperty("paused", true);

   // A field left focused in the previous editor must not consume Space after opening.
   await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "previous-editor-focus";
      document.body.append(input);
      input.focus();
   });
   await app.evaluate(({ app }, path) => app.emit("second-instance", {}, [process.execPath, path]), resolve("work/fixture.mkv"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await waitForVideo(page);
   await expect(page.locator("#previous-editor-focus")).not.toBeFocused();
   await page.keyboard.press("Space");
   await expect(video).toHaveJSProperty("paused", false);
   await page.keyboard.press("Space");
   await expect(video).toHaveJSProperty("paused", true);

   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await expect(page.locator(".player-stage.fullscreen")).toHaveCount(1);
   await page.locator(".player-stage").click();
   await expect(video).toHaveJSProperty("paused", false);
   await expect(page.locator(".fullscreen-controls")).toHaveClass(/hidden/);
   // Click without moving the pointer so the hidden-controls path is exercised.
   await page.mouse.down();
   await page.mouse.up();
   await expect(video).toHaveJSProperty("paused", true);
});
