import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
const profile = await mkdtemp(resolve("work/user-testing-"));
const app = await electron.launch({
   args: ["."],
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
try {
   const page = await app.firstWindow();
   page.setDefaultTimeout(15000);
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + bar.width / 3, bar.y + 36);
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toBeVisible();
   await page.mouse.click(bar.x + bar.width * 0.8, bar.y + 36);
   await expect(page.locator("[data-command=merge]")).toBeDisabled();
   await expect(page.locator("[data-command=split]")).toBeEnabled();
   const handle = page.getByRole("slider", { name: "Clip 1 end", exact: true });
   const target = Number(await handle.getAttribute("aria-valuenow"));
   await handle.click();
   await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeCloseTo(target, 2);
   console.log("Handle click seeks correctly:", target);
   // The forgiving seam target belongs to Merge, even when slightly off the cut.
   await page.mouse.click(bar.x + (bar.width * target) / 18 + 6, bar.y + 36);
   await expect(page.locator("[data-command=merge]")).toBeEnabled();
   await expect(page.locator("[data-command=split]")).toBeDisabled();
   await page.locator("[data-command=merge]").click();
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1);
   await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeCloseTo(target, 2);
   await expect(page.locator("[data-command=split]")).toBeEnabled();
   await page.keyboard.press("s");
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveAttribute("aria-valuenow", String(target));
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("button", { name: "Merged Video", exact: true }).click();
   await page.getByLabel("Combined filename", { exact: true }).fill("retained");
   await page.getByLabel("Save to", { exact: true }).fill(profile + "/new-folder");
   await page.getByRole("switch", { name: "Mute audio", exact: true }).check();
   await page.keyboard.press("Escape");
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByLabel("Combined filename", { exact: true })).toHaveValue("retained");
   await expect(page.getByRole("switch", { name: "Mute audio", exact: true })).toBeChecked();
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await expect(page.getByRole("dialog", { name: "Create output folder?", exact: true })).toBeVisible();
   await page.waitForTimeout(200);
   await page.screenshot({ path: resolve("work/export-create-warning.png") });
   await page.getByRole("button", { name: "Cancel", exact: true }).click();
   await expect(page.getByRole("dialog", { name: "Export clips", exact: true })).toBeVisible();
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await page.getByRole("button", { name: "Create folder and export", exact: true }).click();
   await expect(page.getByRole("button", { name: "Open file", exact: true })).toBeVisible({ timeout: 60000 });
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await expect(page.getByRole("dialog", { name: "Replace existing files?", exact: true })).toBeVisible();
   await page.waitForTimeout(200);
   await page.screenshot({ path: resolve("work/export-overwrite-warning.png") });
   await page.getByRole("button", { name: "Replace and export", exact: true }).click();
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await expect(page.getByRole("button", { name: "Open file", exact: true })).toBeVisible({ timeout: 60000 });
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("button", { name: "Separate clips", exact: true }).click();
   await page.getByRole("textbox", { name: "Clip 1 filename", exact: true }).fill("first-kept-name");
   await page.getByRole("checkbox", { name: "Export clip 2", exact: true }).uncheck();
   await page.keyboard.press("Escape");
   await expect(page.getByRole("dialog")).toHaveCount(0);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByRole("button", { name: "Separate clips", exact: true })).toHaveAttribute("aria-pressed", "true");
   await expect(page.getByRole("textbox", { name: "Clip 1 filename", exact: true })).toHaveValue("first-kept-name");
   await expect(page.getByRole("checkbox", { name: "Export clip 2", exact: true })).not.toBeChecked();
   console.log("Export persistence, missing folder, cancel and overwrite passed");
} finally {
   await app.close();
}
