import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("volume opens on hover and keyboard focus in the toolbar and fullscreen", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const control = page.locator(".transport .volume-control");
   const mute = control.getByRole("button");
   const slider = control.locator("input");
   await page.mouse.move(10, 10);
   await expect(slider).toBeHidden();
   await mute.hover();
   await expect(slider).toBeVisible();
   const iconBox = await mute.boundingBox();
   const sliderBox = await slider.boundingBox();
   // Leave sideways first, then approach the slider diagonally through the gap.
   await page.mouse.move(iconBox.x - 14, iconBox.y + iconBox.height / 2);
   await page.waitForTimeout(120);
   await expect(slider).toBeVisible();
   await page.mouse.move(sliderBox.x + 6, sliderBox.y + sliderBox.height / 2, { steps: 8 });
   await expect(slider).toBeVisible();
   await page.evaluate(() => {
      globalThis.volumeIconAnimations = [];
      document
         .querySelector(".transport .volume-control")
         .addEventListener("animationstart", (event) => globalThis.volumeIconAnimations.push(event.animationName));
   });
   await slider.fill("0");
   await expect(mute.locator("svg")).toHaveAttribute("data-icon", "volume-xmark");
   await expect.poll(() => page.evaluate(() => globalThis.volumeIconAnimations.includes("icon-rattle"))).toBe(true);
   await slider.fill("0.1");
   await expect(mute.locator("svg")).toHaveAttribute("data-icon", "volume-off");
   await expect.poll(() => page.evaluate(() => globalThis.volumeIconAnimations.includes("icon-wave"))).toBe(true);
   await slider.fill("0.3");
   await expect(page.locator("video")).toHaveJSProperty("volume", 0.3);
   await mute.click();
   await expect(page.locator("video")).toHaveJSProperty("muted", true);
   await expect(mute.locator("svg")).toHaveAttribute("data-icon", "volume-xmark");
   await mute.click();
   await expect(page.locator("video")).toHaveJSProperty("muted", false);
   await page.locator("video").click();
   await page.mouse.move(10, 10);
   await expect(slider).toBeHidden();
   await mute.focus();
   await expect(slider).toBeVisible();
   await page.keyboard.press("Tab");
   await expect(slider).toBeFocused();
   await page.keyboard.press("ArrowRight");
   await expect(page.locator("video")).toHaveJSProperty("volume", 0.31);
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   const fullscreen = page.locator(".fullscreen-controls .volume-control");
   await fullscreen.getByRole("button").hover();
   await expect(fullscreen.locator("input")).toBeVisible();
   await fullscreen.locator("input").fill("0.6");
   await expect(page.locator("video")).toHaveJSProperty("volume", 0.6);
   await expect(fullscreen.locator("button svg")).toHaveAttribute("data-icon", "volume-low");
   await fullscreen.locator("input").fill("0.67");
   await expect(fullscreen.locator("button svg")).toHaveAttribute("data-icon", "volume-high");
   await fullscreen.locator("input").fill("0.33");
   await expect(fullscreen.locator("button svg")).toHaveAttribute("data-icon", "volume-low");
   await page.keyboard.press("Escape");
   await mute.hover();
   await expect(control.locator(".volume-popover")).toHaveCSS("opacity", "1");
   await page.screenshot({ path: "work/volume-popover.png" });
});
