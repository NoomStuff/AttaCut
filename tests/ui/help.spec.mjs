import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("help", async ({ launchApp, profile }) => {
   const application = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await application.firstWindow();
   await page.getByRole("slider", { name: "Clip 1 start", exact: true }).waitFor();
   await waitForVideo(page);

   // Help opens with F1 and switches tabs.
   await page.keyboard.press("F1");
   const help = page.getByRole("dialog", { name: "Help", exact: true });
   await help.waitFor();
   for (const tab of ["Getting started", "Clips and gaps", "Cutting losslessly"]) {
      await help.getByRole("tab", { name: tab }).click();
   }

   // The About panel comes from the Help menu and shows a real version.
   await page.keyboard.press("Escape");
   await page.getByRole("button", { name: "Help", exact: true }).click();
   await page.getByRole("menuitem", { name: "About" }).click();
   const about = page.getByRole("dialog", { name: "About" });
   await about.waitFor();
   await expect(about.getByText(/Version \d+\.\d+\.\d+/)).toBeVisible();
   await page.keyboard.press("Escape");

   // The export panel shows the re-encode note and links into the cutting topic.
   await page.getByRole("button", { name: "Export", exact: true }).click();
   const exportDialog = page.getByRole("dialog", { name: "Export video" });
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

   console.log("Help panel checks passed");
});
