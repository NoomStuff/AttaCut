import { expect } from "@playwright/test";
import { test } from "./app.mjs";

test("shortcut search focus and reset confirmation", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await expect(page.getByRole("button", { name: "Import video", exact: true })).toBeVisible();
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560));
   await page.keyboard.press("ControlOrMeta+,");
   await page.getByRole("tab", { name: "Keyboard shortcuts" }).click();
   const search = page.getByRole("searchbox", { name: "Search shortcuts" });
   await expect(search).toBeFocused();
   await expect(search).toHaveCSS("outline-style", "none");
   await expect(search).toHaveCSS("box-shadow", "none");
   await page.keyboard.press("Tab");
   await page.keyboard.press("Shift+Tab");
   await expect(search).toBeFocused();
   await expect(search).toHaveCSS("box-shadow", /inset/);
   await search.click();
   await expect(search).toHaveCSS("box-shadow", "none");

   const importBindings = page.getByRole("button", { name: /^Change .* for Import video$/ });
   const defaults = await importBindings.count();
   await page.getByRole("button", { name: "Add binding for Import video" }).click();
   await page.getByRole("button", { name: "Record binding for Import video" }).press("ControlOrMeta+Alt+9");
   await page.getByRole("button", { name: "Save binding" }).click();
   await expect(importBindings).toHaveCount(defaults + 1);

   await page.getByRole("button", { name: "Reset bindings" }).click();
   const confirmation = page.getByRole("dialog", { name: "Reset keyboard shortcuts?" });
   await expect(confirmation).toBeVisible();
   await confirmation.getByRole("button", { name: "Cancel" }).click();
   await expect(confirmation).not.toBeVisible();
   await expect(importBindings).toHaveCount(defaults + 1);

   await page.getByRole("button", { name: "Reset bindings" }).click();
   await confirmation.getByRole("button", { name: "Reset bindings" }).click();
   await expect(confirmation).not.toBeVisible();
   await expect(importBindings).toHaveCount(defaults);
});

test("settings keeps its layout while closing", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Import video", exact: true }).waitFor();
   await page.keyboard.press("ControlOrMeta+,");
   const initial = await page.locator(".settings-modal").evaluate((dialog) => dialog.getBoundingClientRect().width);
   await page.evaluate(() => {
      const dialog = document.querySelector(".settings-modal");
      const observer = new globalThis.MutationObserver(() => {
         if (!dialog.classList.contains("closing")) return;
         globalThis.requestAnimationFrame(() => {
            globalThis.settingsCloseLayout = {
               width: dialog.getBoundingClientRect().width,
               display: globalThis.getComputedStyle(dialog).display,
               descriptionWidth: dialog.querySelector(".setting-row small").getBoundingClientRect().width,
            };
         });
         observer.disconnect();
      });
      observer.observe(dialog, { attributes: true, attributeFilter: ["class"] });
   });
   await page.getByRole("button", { name: "Close panel" }).click();
   await expect.poll(() => page.evaluate(() => globalThis.settingsCloseLayout)).toBeTruthy();
   const closing = await page.evaluate(() => globalThis.settingsCloseLayout);
   expect(closing.display).toBe("flex");
   expect(closing.width).toBeGreaterThan(initial - 2);
   expect(closing.descriptionWidth).toBeGreaterThan(100);
});
