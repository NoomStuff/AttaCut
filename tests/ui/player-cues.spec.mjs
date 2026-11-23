import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("skips, volume steps and play toggles show what actually changed over the video", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   const skip = page.locator(".player-skip");
   const badge = page.locator(".player-pill");

   // Back at 0:00 the playhead can't move, so nothing shows.
   await page.keyboard.press("ArrowLeft");
   await page.waitForTimeout(150);
   await expect(skip).toHaveCount(0);
   // Quick repeats add up in one indicator.
   await page.keyboard.press("ArrowRight");
   await expect(skip).toHaveText("+1s");
   await page.keyboard.press("Shift+ArrowRight");
   await expect(skip).toHaveText("+6s");
   await expect(skip).toHaveAttribute("data-side", "forward");
   await expect(skip).toHaveCount(0);
   await page.keyboard.press("ArrowLeft");
   await expect(skip).toHaveText("−1s");
   await expect(skip).toHaveAttribute("data-side", "back");

   // Volume steps by 5% and shows the level. Stepping down past the bottom mutes and keeps the level.
   await page.keyboard.press("ArrowDown");
   await expect(video).toHaveJSProperty("volume", 0.65);
   await expect(badge).toHaveText("65%");
   await page.keyboard.press("ArrowUp");
   await expect(video).toHaveJSProperty("volume", 0.7);
   await expect(badge).toHaveText("70%");
   await expect(badge).toHaveCount(0);
   await page.locator(".transport .volume-control").getByRole("button").click();
   await expect(video).toHaveJSProperty("muted", true);
   // Already muted, so stepping down changes nothing and shows nothing.
   await page.keyboard.press("ArrowDown");
   await page.waitForTimeout(150);
   await expect(badge).toHaveCount(0);
   await page.keyboard.press("ArrowUp");
   await expect(video).toHaveJSProperty("muted", false);
   await expect(badge).toHaveText("70%");
   // The wheel over the video steps volume too.
   await page.locator(".player-stage").hover();
   await page.mouse.wheel(0, 100);
   await expect(video).toHaveJSProperty("volume", 0.65);

   // Space shows the play mark, the transport's own button doesn't, and neither turns on keyboard mode.
   await page.mouse.move(10, 10);
   await page.keyboard.press("Space");
   await expect(page.locator(".player-flash")).toHaveCount(1);
   await expect(page.locator(".player-flash svg")).toHaveAttribute("data-icon", "play");
   await expect(page.locator(".player-flash")).toHaveCount(0);
   await page.locator(".transport").getByRole("button", { name: "Pause", exact: true }).click();
   await expect(video).toHaveJSProperty("paused", true);
   await page.waitForTimeout(100);
   await expect(page.locator(".player-flash")).toHaveCount(0);
   // A clicked button gives Space back to the player.
   await page.keyboard.press("Space");
   await expect(video).toHaveJSProperty("paused", false);
   expect(await page.evaluate(() => document.documentElement.hasAttribute("data-keyboard"))).toBe(false);

   // Holding the video plays at double speed until release, and the release doesn't pause.
   const stage = await page.locator(".player-stage").boundingBox();
   await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
   await page.mouse.down();
   await expect(video).toHaveJSProperty("playbackRate", 2);
   await expect(badge).toHaveText("2×");
   await page.mouse.up();
   await expect(video).toHaveJSProperty("playbackRate", 1);
   await expect(video).toHaveJSProperty("paused", false);
   // A plain click still pauses, with its own mark.
   await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2);
   await expect(video).toHaveJSProperty("paused", true);
   await expect(page.locator(".player-flash svg")).toHaveAttribute("data-icon", "pause");
});

test("a keyboard-focused button keeps Enter and Space, and shortcuts leave keyboard mode off", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const video = page.locator("video");
   const keyboardMode = () => page.evaluate(() => document.documentElement.hasAttribute("data-keyboard"));
   await page.keyboard.press("ArrowRight");
   await page.keyboard.press("m");
   expect(await keyboardMode()).toBe(false);
   await page.keyboard.press("m");
   const fullscreen = page.locator(".transport").getByRole("button", { name: "Fullscreen video", exact: true });
   await fullscreen.focus();
   await page.keyboard.press("Tab");
   await page.keyboard.press("Shift+Tab");
   await expect(fullscreen).toBeFocused();
   expect(await keyboardMode()).toBe(true);
   await page.keyboard.press("Space");
   await expect(page.locator(".player-stage.fullscreen")).toHaveCount(1);
   await expect(video).toHaveJSProperty("paused", true);
});
