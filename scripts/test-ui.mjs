import { _electron as electron, expect } from "@playwright/test";
import { resolve, join } from "node:path";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
await mkdir("work/screenshots", { recursive: true });
const profile = await mkdtemp(resolve("work/ui-profile-"));
const output = join(profile, "exports");
await mkdir(output);
const application = await electron.launch({
   args: process.env.ATTACUT_EXECUTABLE ? [] : ["."],
   ...(process.env.ATTACUT_EXECUTABLE ? { executablePath: process.env.ATTACUT_EXECUTABLE } : {}),
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
const errors = [];
try {
   const page = await application.firstWindow();
   // Chromium can stop producing screenshots for a window that has never been shown.
   await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   page.setDefaultTimeout(15000);
   page.on("pageerror", (error) => errors.push(error.message));
   await page.getByRole("slider", { name: "Clip 1 start", exact: true }).waitFor();
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   const end = page.getByRole("textbox", { name: "Clip end", exact: true });
   await start.fill("00:01.30");
   await start.press("Tab");
   await end.fill("00:14.70");
   await end.press("Tab");
   await page.locator(".title-filename").click();
   await page.keyboard.press("Shift+ArrowLeft");
   await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 9.7) < 0.01);
   await page.keyboard.press("s");
   const second = page.getByRole("slider", { name: "Clip 2 start", exact: true });
   await expect(second).toHaveAttribute("aria-valuenow", "9.7");
   await start.fill("00:10.20");
   await start.press("Tab");
   await expect(second).toHaveAttribute("aria-valuenow", "10.2");
   await start.fill("00:12.00");
   await start.press("Escape");
   await expect(start).toHaveValue("00:10.20");
   await expect(second).toHaveAttribute("aria-valuenow", "10.2");
   const box = await second.boundingBox();
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
   await page.mouse.down();
   await page.mouse.move(box.x + 75, box.y + 10, { steps: 5 });
   await page.keyboard.press("Escape");
   await page.mouse.up();
   await expect(second).toHaveAttribute("aria-valuenow", "10.2");
   await page.keyboard.press("Control+z");
   await expect(second).toHaveAttribute("aria-valuenow", "9.7");
   await page.keyboard.press("Control+Shift+z");
   await expect(second).toHaveAttribute("aria-valuenow", "10.2");
   await page.screenshot({ path: "work/screenshots/editor.png" });
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("dialog", { name: "Export clips" }).waitFor();
   await expect(page.getByRole("textbox", { name: "Clip 1 filename", exact: true })).toHaveValue("fixture (1)");
   await expect(page.getByRole("textbox", { name: "Clip 2 filename", exact: true })).toHaveValue("fixture (2)");
   await page.getByLabel("Save to", { exact: true }).fill(output);
   const exportButton = page.getByRole("button", { name: "Export 2 clips", exact: true });
   await expect(exportButton).toBeEnabled({ timeout: 20000 });
   await page.screenshot({ path: "work/screenshots/export.png" });
   await exportButton.click();
   await page.getByText("2 clips exported", { exact: true }).waitFor({ timeout: 30000 });
   expect((await readdir(output)).filter((name) => name.endsWith(".mp4"))).toHaveLength(2);
   await page.getByRole("button", { name: "Dismiss export status" }).click();
   await page.getByRole("button", { name: "Playback settings" }).click();
   await page.getByRole("switch", { name: "Play kept clips only" }).check();
   await page.getByRole("tab", { name: "Keyboard shortcuts" }).click();
   await page.getByRole("button", { name: "Change shortcut for Split at playhead" }).click();
   await page.keyboard.press("x");
   await page.getByRole("button", { name: "Change shortcut for Split at playhead" }).getByText("X", { exact: true }).waitFor();
   await page.screenshot({ path: "work/screenshots/shortcuts.png" });
   await page.getByRole("tab", { name: "General", exact: true }).click();
   await page.getByRole("button", { name: "Light theme", exact: true }).click();
   await expect(page.getByRole("button", { name: "Light theme", exact: true })).toHaveAttribute("aria-pressed", "true");
   await page.getByRole("button", { name: "Close panel", exact: true }).click();
   await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "detached" });
   await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
   await page.screenshot({ path: "work/screenshots/small-light.png" });
   const playBox = await page.getByRole("button", { name: "Play", exact: true }).boundingBox();
   expect(playBox.y + playBox.height).toBeLessThanOrEqual(640);
   expect(errors).toEqual([]);
   console.log("UI passed: seeking, trim, split, cancelled drag, undo/redo, actual export, shortcuts, themes, and 960×640 layout.");
} catch (error) {
   const page = await application.firstWindow();
   await page.screenshot({ path: "work/screenshots/failure.png" });
   throw error;
} finally {
   await application.close();
}
const restored = await electron.launch({
   args: process.env.ATTACUT_EXECUTABLE ? [] : ["."],
   ...(process.env.ATTACUT_EXECUTABLE ? { executablePath: process.env.ATTACUT_EXECUTABLE } : {}),
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: "" },
});
try {
   const page = await restored.firstWindow();
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveAttribute("aria-valuenow", "10.2");
   await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
   console.log("Session restoration passed.");
} finally {
   await restored.close();
}
