import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

const longVideo = process.env.ATTACUT_LONG_VIDEO;

test.skip(!longVideo, "set ATTACUT_LONG_VIDEO to exercise a multi-hour recording");

test("opens, plays, scrubs, and steps a multi-hour recording", async ({ launchApp, profile }) => {
   const application = await launchApp(profile, resolve(longVideo));
   const page = await application.firstWindow();
   await waitForVideo(page);
   // A two-hour recording must open natively without a proxy preview.
   await expect(page.getByText(/Preparing preview/i)).toHaveCount(0);

   // Playing advances the clock.
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video")?.currentTime > 1, undefined, { timeout: 30000 });
   await page.getByRole("button", { name: "Pause", exact: true }).click();

   // Jump across the recording: a cold seek into a far region must land, not spin.
   await page.getByRole("textbox", { name: "Clip start", exact: true }).fill("01:30:00");
   const seekStart = Date.now();
   await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
   await page.waitForFunction(() => Math.abs(document.querySelector("video")?.currentTime - 5400) < 0.5, undefined, { timeout: 20000 });
   const seekMs = Date.now() - seekStart;
   console.log(`far seek landed in ${seekMs}ms`);
   expect(seekMs).toBeLessThan(750);

   // Frame stepping works deep into the recording.
   await page.keyboard.press("ArrowRight");
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, undefined, { timeout: 15000 });
   expect(await page.evaluate(() => document.querySelector("video").error)).toBeNull();

   // Another cold jump to the last minute, then play across the boundary region.
   await page.getByRole("textbox", { name: "Clip end", exact: true }).fill("01:54:00");
   await page.getByRole("textbox", { name: "Clip end", exact: true }).press("Tab");
   await page.waitForFunction(() => Math.abs(document.querySelector("video")?.currentTime - 6840) < 0.5, undefined, { timeout: 20000 });
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video")?.currentTime > 6840.2, undefined, { timeout: 30000 });
   expect(await page.evaluate(() => document.querySelector("video").error)).toBeNull();
});
