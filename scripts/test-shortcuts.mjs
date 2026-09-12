import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
const profile = await mkdtemp(resolve("work/shortcuts-"));
const app = await electron.launch({
   args: ["."],
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
try {
   const page = await app.firstWindow();
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   const seek = async (time) => {
      const bar = await page.locator(".timeline-viewport").boundingBox();
      await page.mouse.click(bar.x + (bar.width * time) / 18, bar.y + 36);
      await page.waitForTimeout(150);
   };
   await seek(6);
   await page.keyboard.press("s");
   await expect(page.locator(".clip-range")).toHaveCount(2);
   await expect(page.locator("[data-command=merge]")).toBeEnabled();
   await page.keyboard.press("e");
   await expect(page.locator(".clip-range")).toHaveCount(1);
   await page.keyboard.press("Control+z");
   await expect(page.locator(".clip-range")).toHaveCount(2);
   await seek(8);
   await page.keyboard.press("w");
   await expect(page.locator(".clip-range")).toHaveCount(1);
   await page.keyboard.press("w");
   await expect(page.locator(".clip-range")).toHaveCount(2);
   await page.keyboard.press("m");
   await expect(page.locator("video")).toHaveJSProperty("muted", true);
   await page.keyboard.press("m");
   await expect(page.locator("video")).toHaveJSProperty("muted", false);
   await page.keyboard.press("c");
   await expect(page.locator("[data-command=snap]")).toHaveAttribute("aria-pressed", "true");
   await page.keyboard.press("c");
   await seek(9);
   await page.keyboard.press("a");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveAttribute("aria-valuenow", /9/);
   await seek(12);
   await page.keyboard.press("d");
   await expect(page.getByRole("slider", { name: "Clip 2 end", exact: true })).toHaveAttribute("aria-valuenow", /12/);
   await seek(10);
   await page.keyboard.press(".");
   await page.waitForTimeout(200);
   const after = await page.locator("video").evaluate((video) => video.currentTime);
   expect(after).toBeGreaterThan(10);
   expect(after).toBeLessThan(10.1);
   await page.keyboard.press(",");
   await page.waitForTimeout(100);
   expect(await page.locator("video").evaluate((video) => video.currentTime)).toBeCloseTo(10, 3);
   await page.screenshot({ path: "work/screenshots/shortcuts.png" });
   console.log("Shortcut and merge workflow passed");
} finally {
   await app.close();
}
