import { expect } from "@playwright/test";
import { test, configureIpc } from "./app.mjs";

test("downloaded updates show the remaining action", async ({ launchApp, profile }) => {
   const application = await launchApp(profile);
   const page = await application.firstWindow();
   const update = { version: "99.0.0", name: "AttaCut 99.0.0", mode: "automatic", url: "https://github.com/NoomStuff/AttaCut/releases" };
   await configureIpc(application, "update:check", { patch: update });
   await page.getByRole("button", { name: "Help", exact: true }).click();
   await page.getByRole("menuitem", { name: "Check for updates", exact: true }).click();
   const status = async (phase) =>
      application.evaluate(({ BrowserWindow }, phase) => {
         BrowserWindow.getAllWindows()[0].webContents.send("update:status", { phase, version: "99.0.0", percent: 100 });
      }, phase);
   await status("ready");
   const restart = page.getByRole("button", { name: "Restart to update", exact: true });
   await expect(restart).toBeVisible();
   await expect(restart.locator('svg[data-icon="download"]')).toBeVisible();
   await expect(restart.locator('svg[data-icon="check"]')).toHaveCount(0);
   await page.screenshot({ path: "test-results/update-ready.png" });
   // The test never downloads or installs anything. The main-process readiness
   // guard rejects the synthetic status after the chip sends the real action.
   await restart.click();
   await expect.poll(() => application.evaluate(() => globalThis.attacutTestIpc.count("update:restart"))).toBe(1);
   await expect(page.locator(".update-chip-trigger.error")).toBeVisible();
   await configureIpc(application, "update:check", { patch: { ...update, mode: "download" } });
   await page.getByRole("button", { name: "Help", exact: true }).click();
   await page.getByRole("menuitem", { name: "Check for updates", exact: true }).click();
   await status("downloaded");
   const reveal = page.getByRole("button", { name: "Show in Downloads", exact: true });
   await expect(reveal).toBeVisible();
   await expect(reveal.locator('svg[data-icon="folder-open"]')).toBeVisible();
   await expect(reveal.locator('svg[data-icon="check"]')).toHaveCount(0);
});
