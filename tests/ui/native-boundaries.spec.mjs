import { expect } from "@playwright/test";
import { test, waitForVideo, waitForPlaybackTime } from "./app.mjs";
import { resolve } from "node:path";

test("IPC refuses requests from another window", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const result = await app.evaluate(async ({ BrowserWindow }) => {
      const other = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
      try {
         await other.loadURL("data:text/html,<p>Untrusted caller</p>");
         return await other.webContents.executeJavaScript(`require("electron").ipcRenderer.invoke("app:bootstrap")`);
      } finally {
         other.destroy();
      }
   });
   expect(result).toMatchObject({ ok: false, error: { code: "invalid-request", retryable: false } });
   await expect(page.locator(".title-filename")).toHaveText("fixture.mp4");
});

test("native menu callbacks route import and editing commands to the renderer", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(bar.x + bar.width / 3, bar.y + 36);
   await waitForPlaybackTime(page, 6);
   await app.evaluate(({ Menu, BrowserWindow }) => {
      const menu = Menu.getApplicationMenu();
      const command = menu.items.flatMap((item) => item.submenu?.items ?? []).find((item) => item.label === "Split at playhead");
      command.click(command, BrowserWindow.getAllWindows()[0], {});
   });
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveAttribute("aria-valuenow", "6");
   await app.evaluate(({ Menu, BrowserWindow, dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      const command = Menu.getApplicationMenu()
         .items.flatMap((item) => item.submenu?.items ?? [])
         .find((item) => item.label.startsWith("Import video"));
      command.click(command, BrowserWindow.getAllWindows()[0], {});
   }, resolve("work/fixture.mkv"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await waitForVideo(page);
});

test("dropped filesystem files use the preload path bridge", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Import video", exact: true }).waitFor();
   await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "drop-fixture";
      document.body.append(input);
   });
   await page.locator("#drop-fixture").setInputFiles(resolve("work/fixture.mp4"));
   const path = await page.evaluate(() => globalThis.desktop.filePath(document.querySelector("#drop-fixture").files[0]));
   expect(path).toBe(resolve("work/fixture.mp4"));
   await page.evaluate(() => {
      const transfer = new globalThis.DataTransfer();
      transfer.items.add(document.querySelector("#drop-fixture").files[0]);
      document.querySelector(".app-shell").dispatchEvent(new globalThis.DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      document.querySelector("#drop-fixture").remove();
   });
   await expect(page.locator(".title-filename")).toHaveText("fixture.mp4");
   await waitForVideo(page);
});
