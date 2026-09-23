import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("clip selection", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const seek = async (time) => {
      const bar = await page.locator(".timeline-viewport").boundingBox();
      await page.mouse.click(bar.x + (bar.width * time) / 18, bar.y + 36);
      await page.waitForTimeout(200);
   };
   const ranges = () => page.locator(".clip-range:not(.exiting)");
   const selected = () => page.locator(".clip-range.selected:not(.exiting)");
   const expectSliderTime = async (name, time) => {
      const slider = page.getByRole("slider", { name, exact: true });
      await expect.poll(async () => Number(await slider.getAttribute("aria-valuenow"))).toBeCloseTo(time, 6);
   };
   await seek(6);
   await page.keyboard.press("s");
   await expect(ranges()).toHaveCount(2);
   await expect(selected().locator(".clip-number")).toHaveText("02");
   for (let i = 0; i < 3; i++) {
      await page.keyboard.press("w");
      await expect(ranges()).toHaveCount(1);
      await expect(selected()).toHaveCount(0);
      await page.keyboard.press("w");
      await expect(ranges()).toHaveCount(2);
      await expect(selected().locator(".clip-number")).toHaveText("02");
   }
   await seek(3);
   await page.keyboard.press("Alt+ArrowRight");
   await expect(selected().locator(".clip-number")).toHaveText("01");
   await page.keyboard.press("w");
   await expect(ranges()).toHaveCount(1);
   await expect(selected()).toHaveCount(0);
   await page.keyboard.press("w");
   await expect(ranges()).toHaveCount(2);
   await expect(selected().locator(".clip-number")).toHaveText("01");

   // Moving into the deleted range clears the previous deletion interaction.
   await page.keyboard.press("w");
   await expect(ranges()).toHaveCount(1);
   await seek(3);
   await expect(selected()).toHaveCount(0);
   await page.keyboard.press("Alt+ArrowRight");
   await expect(selected()).toHaveCount(1);
   // Explicit Add works at the remaining clip's start, despite Delete also being available.
   await expect(page.locator("[data-command=add]")).toBeEnabled();
   await page.locator("[data-command=add]").click();
   await expect(ranges()).toHaveCount(2);

   // A former handle focus must not steal navigation after a mouse seek.
   await page.getByRole("slider", { name: "Clip 1 end", exact: true }).focus();
   await seek(10);
   await page.keyboard.press("ArrowRight");
   await page.waitForTimeout(250);
   const navigated = await page.locator("video").evaluate((video) => video.currentTime);
   assert.ok(Math.abs(navigated - 11) < 0.05, `Expected 11 seconds after mouse + keyboard navigation, got ${navigated}`);
   await page.keyboard.press(".");
   await page.waitForTimeout(250);
   assert.ok((await page.locator("video").evaluate((video) => video.currentTime)) > 11);
   // Toggle uses normal Add semantics; Undo restores the original trimmed range.
   await seek(12);
   await page.keyboard.press("d");
   await expectSliderTime("Clip 2 end", 12);
   await page.keyboard.press("w");
   await expect(ranges()).toHaveCount(1);
   await page.keyboard.press("w");
   await expect(ranges()).toHaveCount(2);
   await expect(page.getByRole("slider", { name: "Clip 2 end", exact: true })).toHaveAttribute("aria-valuenow", "18");
   await page.keyboard.press("ControlOrMeta+z");
   await expect(ranges()).toHaveCount(1);
   await page.keyboard.press("ControlOrMeta+z");
   await expect(ranges()).toHaveCount(2);
   await expectSliderTime("Clip 2 end", 12);
   // Explicit Delete keeps removing existing clips, while Toggle preserves the gap priority.
   await seek(8);
   await page.keyboard.press("Alt+ArrowLeft");
   await expect(selected().locator(".clip-number")).toHaveText("02");
   await page.keyboard.press("Delete");
   await expect(ranges()).toHaveCount(1);
   await expect(page.locator("[data-command=delete]")).toBeEnabled();
   await page.keyboard.press("Delete");
   await expect(ranges()).toHaveCount(0);
   await expect(page.locator("[data-command=delete]")).toBeDisabled();
   await page.keyboard.press("ControlOrMeta+z");
   await page.keyboard.press("ControlOrMeta+z");
   await expect(ranges()).toHaveCount(2);
   const handle = page.getByRole("slider", { name: "Clip 2 start", exact: true });
   await handle.click();
   await expect(handle).not.toBeFocused();
   await expect(selected().locator(".clip-number")).toHaveText("02");
   // Pointer commands use the same validity and targeting as shortcuts.
   await page.locator("[data-command=delete]").click();
   await expect(ranges()).toHaveCount(1);
   await page.locator("[data-command=add]").click();
   await expect(ranges()).toHaveCount(2);
   await page.locator("[data-command=delete]").click();
   await expect(ranges()).toHaveCount(1);
   await page.locator("[data-command=delete]").click();
   await expect(ranges()).toHaveCount(0);
   await page.keyboard.press("ControlOrMeta+z");
   await page.keyboard.press("ControlOrMeta+z");
   await expect(ranges()).toHaveCount(2);
   await page.getByRole("slider", { name: "Clip 1 end", exact: true }).focus();
   await page.keyboard.press("Tab");
   await expect(handle).toBeFocused();
   assert.equal(await handle.evaluate((element) => element.matches(":focus-visible")), true);
   await handle.click();
   await expect(handle).not.toBeFocused();
   console.log("Clip priority, repeated toggle, explicit add, and mouse/keyboard navigation passed");
});
