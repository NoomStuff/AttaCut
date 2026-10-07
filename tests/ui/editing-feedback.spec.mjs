import { expect } from "@playwright/test";
import { test, waitForPlaybackTime, waitForVideo } from "./app.mjs";
import { join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";

test("split feedback finishes during playback and restarts for a rapid second split", async ({ launchApp, profile }) => {
   await writeFile(join(profile, "settings.json"), JSON.stringify({ version: 1, preferences: { keepPlaying: true }, session: null }));
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + bar.width / 6, bar.y + 36);
   await waitForPlaybackTime(page, 3);
   await page.evaluate(() => {
      globalThis.clipFeedback = [];
      for (const type of ["animationstart", "animationend", "animationcancel"]) {
         document.addEventListener(type, (event) => {
            if (event.animationName === "clip-flash") globalThis.clipFeedback.push({ type, id: event.target.dataset.clipId, elapsed: event.elapsedTime });
         });
      }
   });
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 3.1);
   await page.keyboard.press("s");
   await page.waitForFunction(() => globalThis.clipFeedback.filter((event) => event.type === "animationstart").length === 2);
   await expect.poll(() => page.evaluate(() => globalThis.clipFeedback.filter((event) => event.type === "animationend").length)).toBe(2);
   expect(await page.evaluate(() => globalThis.clipFeedback.filter((event) => event.type === "animationcancel"))).toEqual([]);
   expect(await page.locator("video").evaluate((video) => video.paused)).toBe(false);

   await page.keyboard.press("s");
   await page.waitForFunction(() => document.querySelectorAll(".clip-range").length === 3);
   const reusedId = await page.locator(".clip-range").nth(2).getAttribute("data-clip-id");
   await page.waitForFunction((id) => globalThis.clipFeedback.some((event) => event.id === id && event.type === "animationstart"), reusedId);
   // Leave enough source frames between cuts while the first flash is still running.
   const time = await page.locator("video").evaluate((video) => video.currentTime);
   await page.waitForFunction((time) => document.querySelector("video").currentTime > time + 0.12, time);
   await page.keyboard.press("s");
   await expect(page.locator(".clip-range")).toHaveCount(4);
   await expect
      .poll(() => page.evaluate((id) => globalThis.clipFeedback.filter((event) => event.id === id && event.type === "animationstart").length, reusedId))
      .toBe(2);
   await expect(page.locator(".clip-range.flash")).toHaveCount(0);
   await expect(page.locator(".split-edge")).toHaveCount(0);
   expect(await page.locator("video").evaluate((video) => video.paused)).toBe(false);
});

test("invalid times restore the accepted cut and picker keys do not seek or edit", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("4.25");
   await start.press("Enter");
   await expect(start).toHaveValue("00:04.23");
   await expect(page.locator(".time-feedback")).toHaveCount(0);
   const accepted = await page.getByRole("slider", { name: "Clip 1 start", exact: true }).getAttribute("aria-valuenow");
   await start.fill("abc");
   await start.press("Enter");
   await expect(start).toHaveValue("00:04.23");
   await expect(page.getByRole("status").filter({ hasText: "Start unchanged" })).toBeVisible();
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", accepted);
   const time = await page.locator(".timeline-time time").first().textContent();
   await page.getByRole("button", { name: "Preview audio tracks", exact: true }).click();
   const first = page.getByRole("option").nth(0);
   const second = page.getByRole("option").nth(1);
   await expect(first).toBeFocused();
   await first.press("Enter");
   await expect(first).toHaveAttribute("aria-selected", "true");
   await first.press("ArrowDown");
   await expect(second).toBeFocused();
   await expect(page.locator(".timeline-time time").first()).toHaveText(time);
   await page.keyboard.press("s");
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1);
   await second.press("Enter");
   await expect(second).toHaveAttribute("aria-selected", "true");
   await page.keyboard.press("Escape");
   await expect(page.getByRole("listbox")).toHaveCount(0);
});
