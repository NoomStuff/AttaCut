import { _electron as electron, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mkdir, mkdtemp } from "node:fs/promises";
await mkdir("work/screenshots", { recursive: true });
const profile = await mkdtemp(resolve("work/help-profile-"));
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

   // Help opens with F1 and switches tabs.
   await page.keyboard.press("F1");
   const help = page.getByRole("dialog", { name: "Help", exact: true });
   await help.waitFor();
   await page.screenshot({ path: "work/screenshots/help-intro.png" });
   for (const [tab, shot] of [
      ["Getting started", "help-start"],
      ["Clips and gaps", "help-clips"],
      ["Cutting losslessly", "help-lossless"],
   ]) {
      await help.getByRole("tab", { name: tab }).click();
      await page.screenshot({ path: `work/screenshots/${shot}.png` });
   }

   // The About panel comes from the Help menu and shows a real version.
   await page.keyboard.press("Escape");
   await page.getByRole("button", { name: "Help", exact: true }).click();
   await page.getByRole("menuitem", { name: "About" }).click();
   const about = page.getByRole("dialog", { name: "About" });
   await about.waitFor();
   await expect(about.getByText(/Version \d+\.\d+\.\d+/)).toBeVisible();
   await page.screenshot({ path: "work/screenshots/about.png" });
   await page.keyboard.press("Escape");

   // The export panel shows the re-encode note and links into the cutting topic.
   await page.getByRole("button", { name: "Export", exact: true }).click();
   const exportDialog = page.getByRole("dialog", { name: "Export clips" });
   await exportDialog.waitFor();
   await expect(exportDialog.getByText(/re-encod|losslessly/)).toBeVisible({ timeout: 20000 });
   await exportDialog.getByRole("button", { name: "Learn More" }).click();
   await help.waitFor();
   await expect(help.getByRole("tab", { name: "Cutting losslessly" })).toHaveAttribute("aria-selected", "true");

   // The shortcuts panel still opens alongside the new Help group.
   await page.keyboard.press("Escape");
   await page.keyboard.press("/");
   await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
   await expect(page.getByRole("tab", { name: "Keyboard shortcuts" })).toHaveAttribute("aria-selected", "true");
   await page.keyboard.press("Escape");

   if (errors.length) throw new Error(errors.join("\n"));
   console.log("Help panel checks passed");
} finally {
   await application.close();
}
