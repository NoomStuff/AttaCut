import { expect } from "@playwright/test";
import { test, waitForPlaybackTime, waitForVideo } from "./app.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

test("native minimize, restore and activation", async ({ launchApp, profile }) => {
   test.skip(process.env.ATTACUT_NATIVE_SMOKE !== "1", "Visible opt-in native smoke");
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(1);
      window.setIgnoreMouseEvents(false);
      window.setSkipTaskbar(false);
      window.show();
      window.focus();
   });
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused())).toBe(true);
   if (process.platform === "darwin") await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
   else await page.getByRole("button", { name: "Minimize window", exact: true }).click();
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
   await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.restore();
      window.focus();
   });
   await expect
      .poll(() =>
         app.evaluate(({ BrowserWindow }) => ({
            minimized: BrowserWindow.getAllWindows()[0].isMinimized(),
            focused: BrowserWindow.getAllWindows()[0].isFocused(),
         }))
      )
      .toEqual({ minimized: false, focused: true });
   if (process.platform === "win32") {
      const bar = await page.locator(".timeline-viewport").boundingBox();
      await page.mouse.click(bar.x + bar.width / 3, bar.y + 36);
      await waitForPlaybackTime(page, 6);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
      await promisify(execFile)(
         "powershell",
         ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('s')"],
         { windowsHide: true }
      );
      await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveAttribute("aria-valuenow", "6");
      await app.evaluate(({ dialog }) => {
         const original = dialog.showOpenDialog;
         dialog.showOpenDialog = async (...args) => {
            globalThis.nativeDialog = { opened: true, resolved: false };
            const result = await original(...args);
            globalThis.nativeDialog = { opened: true, resolved: true, canceled: result.canceled };
            return result;
         };
      });
      const keys = async (value) =>
         promisify(execFile)(
            "powershell",
            ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${value}')`],
            { windowsHide: true }
         );
      await keys("^o");
      await expect.poll(() => app.evaluate(() => globalThis.nativeDialog?.opened)).toBe(true);
      await expect
         .poll(async () => {
            const state = await app.evaluate(() => globalThis.nativeDialog);
            if (!state.resolved) await keys("{ESC}");
            return state.resolved;
         })
         .toBe(true);
      expect(await app.evaluate(() => globalThis.nativeDialog.canceled)).toBe(true);
      await expect(page.locator(".title-filename")).toHaveText("fixture.mp4");
   }
   const before = await page.locator("video").evaluate((video) => video.currentTime);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction((before) => document.querySelector("video").currentTime > before + 0.3, before);
});
