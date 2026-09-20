import { expect } from "@playwright/test";
import { test } from "./app.mjs";
import { resolve } from "node:path";

test("kept playback", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   const video = page.locator("video");
   const bar = await page.locator(".timeline-viewport").boundingBox();
   const clickTime = (time) => page.mouse.click(bar.x + (bar.width * time) / 18, bar.y + 36);
   const at = (start, end = start + 0.5, paused = false) =>
      page.waitForFunction(
         ({ start, end, paused }) => {
            const video = document.querySelector("video");
            return !video.seeking && video.paused === paused && video.currentTime >= start - 0.001 && video.currentTime <= end;
         },
         { start, end, paused }
      );
   const trim = async (start, end) => {
      for (const [name, time] of [
         ["start", start],
         ["end", end],
      ]) {
         const field = page.getByRole("textbox", { name: `Clip ${name}`, exact: true });
         await field.fill(String(time));
         await field.press("Tab");
      }
   };
   await trim(1, 3);
   await clickTime(4);
   await page.getByRole("button", { name: "Add clip in gap", exact: true }).click();
   await trim(6, 8);
   await clickTime(9);
   await page.getByRole("button", { name: "Add clip in gap", exact: true }).click();
   await trim(11, 13);
   await page.getByRole("button", { name: "Playback settings", exact: true }).click();
   await page.getByRole("switch", { name: "Play kept clips only", exact: true }).check();
   await page.keyboard.press("Escape");

   // Paused inspection of gaps stays put. Play moves to the next kept range.
   await clickTime(4);
   await at(4, 4.01, true);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await at(6);
   await page.getByRole("button", { name: "Pause", exact: true }).click();

   // Natural playback crosses both gaps and stops exactly at the final kept end.
   await clickTime(2.8);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await at(6);
   await at(11);
   await at(13, 13.001, true);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await at(1);
   await page.getByRole("button", { name: "Pause", exact: true }).click();

   await page.getByRole("button", { name: "Playback settings", exact: true }).click();
   await page.getByRole("switch", { name: "Keep playing while editing", exact: true }).check();
   await page.keyboard.press("Escape");
   await clickTime(1.2);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await clickTime(4);
   await at(6);
   await clickTime(9);
   await at(11);

   // Rapid scrubbing across deleted ranges must settle on the last request.
   await page.mouse.move(bar.x + (bar.width * 4) / 18, bar.y + 36);
   await page.mouse.down();
   for (const time of [9, 4, 9, 4, 9]) await page.mouse.move(bar.x + (bar.width * time) / 18, bar.y + 36);
   await page.mouse.up();
   await at(11);
   await clickTime(16);
   await at(13, 13.001, true);

   // Play can arrive before a queued seek has decoded. It must use the requested position.
   await page.mouse.move(bar.x + (bar.width * 4) / 18, bar.y + 36);
   await page.mouse.down();
   await page.evaluate(() => {
      const bar = document.querySelector(".timeline-viewport");
      const box = bar.getBoundingClientRect();
      const options = { bubbles: true, button: 0, pointerId: 1, clientX: box.x + (box.width * 4) / 18, clientY: box.y + 36 };
      bar.dispatchEvent(new globalThis.PointerEvent("pointermove", { ...options, clientX: box.x + (box.width * 9) / 18 }));
      bar.dispatchEvent(new globalThis.PointerEvent("pointermove", options));
      document.querySelector('button[aria-label="Play"]').click();
   });
   await page.mouse.up();
   await at(6);
   await page.getByRole("button", { name: "Pause", exact: true }).click();

   // Clip preview overrides kept-only mode and ends at the selected clip's end.
   await clickTime(1.5);
   await page.keyboard.press("p");
   await at(1);
   await at(3, 3.001, true);
   await expect(video).toHaveJSProperty("paused", true);
   console.log("PASS kept-only natural gaps, paused/playing gap clicks, rapid scrubbing, final stop/restart, pending seek + Play, one-clip preview");
});
