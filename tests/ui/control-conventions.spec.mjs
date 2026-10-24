import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("menus and pickers leave on Tab and restore their trigger on Escape", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await expect(page.locator(".loading-overlay")).toHaveCount(0);
   const file = page.getByRole("button", { name: "File", exact: true });
   await file.focus();
   await page.keyboard.press("ArrowDown");
   await expect(page.getByRole("menuitem").first()).toBeFocused();
   await page.keyboard.press("Tab");
   await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeFocused();
   await expect(page.getByRole("menu")).toHaveCount(0);
   await file.focus();
   await page.keyboard.press("ArrowUp");
   await expect(page.locator('[role="menuitem"]:not(:disabled)').last()).toBeFocused();
   await page.keyboard.press("Escape");
   await expect(file).toBeFocused();
   await page.keyboard.press("ControlOrMeta+,");
   await page.getByRole("tab", { name: "Keyboard shortcuts", exact: true }).click();
   const picker = page.getByRole("button", { name: "Hold to snap", exact: true });
   await picker.focus();
   await page.keyboard.press("ArrowDown");
   await expect(page.getByRole("option", { name: "Alt", exact: true })).toBeFocused();
   await page.keyboard.press("Escape");
   await expect(picker).toBeFocused();
   await expect(picker).toHaveAttribute("aria-expanded", "false");
   await page.keyboard.press("ArrowUp");
   await expect(page.getByRole("option", { name: "Alt", exact: true })).toBeFocused();
   await page.keyboard.press("Shift+Tab");
   await expect(picker).toBeFocused();
   await expect(picker).toHaveAttribute("aria-expanded", "false");
   await page.keyboard.press("ArrowDown");
   await expect(page.getByRole("option", { name: "Alt", exact: true })).toBeFocused();
   await page.keyboard.press("Tab");
   await expect(picker).not.toBeFocused();
   await expect(page.getByRole("option")).toHaveCount(0);
   await page.keyboard.press("Escape");
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await page.getByRole("button", { name: "Help", exact: true }).click();
   await page.getByRole("menuitem", { name: /^Help/ }).click();
   await expect(page.getByRole("dialog", { name: "Help", exact: true })).toBeVisible();
   await page.keyboard.press("Escape");
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await page.getByRole("button", { name: "View", exact: true }).click();
   await page.getByRole("menuitem", { name: "Settings…", exact: false }).click();
   await expect(page.getByRole("dialog", { name: "Settings", exact: true })).toBeVisible();
});

test("compact editor keeps timing and preview controls within the window", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   for (const width of [800, 980, 1050, 1160, 1161, 1280]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 560), width);
      await expect
         .poll(() =>
            page.locator(".transport").evaluate((transport) => {
               const bounds = transport.getBoundingClientRect();
               return [...transport.querySelectorAll("button, .time-field input")].every((element) => {
                  const rect = element.getBoundingClientRect();
                  return rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.bottom <= globalThis.innerHeight;
               });
            })
         )
         .toBe(true);
      await expect(page.getByRole("textbox", { name: "Clip start", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Play", exact: true })).toHaveCSS("width", "39px");
      await expect
         .poll(() =>
            page.getByRole("button", { name: "Play", exact: true }).evaluate((button) => {
               const rect = button.getBoundingClientRect();
               return Math.abs(rect.left + rect.width / 2 - globalThis.innerWidth / 2);
            })
         )
         .toBeLessThan(1);
      await expect
         .poll(() =>
            page.locator(".clip-details").evaluate((details) => {
               const start = details.querySelector(".time-field > span").getBoundingClientRect();
               const duration = details.querySelector(".clip-duration small").getBoundingClientRect();
               return Math.abs(start.top + start.height / 2 - duration.top - duration.height / 2);
            })
         )
         .toBeLessThan(1);
      if (width <= 1160) {
         await expect
            .poll(() =>
               page.locator(".clip-details").evaluate((details) => {
                  const timing = details.querySelector(".clip-boundaries").getBoundingClientRect();
                  return Math.abs(details.getBoundingClientRect().right - timing.right);
               })
            )
            .toBeLessThan(1);
      }
   }
});
