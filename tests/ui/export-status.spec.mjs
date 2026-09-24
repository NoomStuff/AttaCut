import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

test("partial export shows separate success and error cards", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 560));
   const message =
      "[aac @ 123] Input buffer exhausted before END element found\nThe filters 'Parsed_setpts_1' and 'format' do not have a common format and automatic conversion is disabled.";
   const job = {
      id: "status-test",
      sourceId: "not-the-active-source",
      replacesSource: false,
      directory: profile,
      running: false,
      items: [
         { id: "ok", name: "first.mp4", outputPath: resolve(profile, "first.mp4"), status: "completed", progress: 1, error: null },
         { id: "bad", name: "second.mp4", outputPath: resolve(profile, "second.mp4"), status: "failed", progress: 0, error: message },
      ],
   };
   await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send("export:progress", value), job);
   await expect(page.getByText("1 file exported", { exact: true })).toBeVisible();
   const errorCard = page.getByRole("alert").filter({ hasText: "Export failed" });
   await expect(errorCard).toBeVisible();
   await expect(errorCard).toContainText("color format");
   await expect(errorCard.getByText(message)).toBeHidden();
   await errorCard.getByText("Technical details").click();
   await expect(errorCard.getByText(message)).toBeVisible();
   await expect(errorCard.getByRole("button", { name: "Show in folder" })).toHaveCount(0);
   await expect(page.getByRole("button", { name: "Show in folder" })).toHaveCount(1);
   await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send("export:progress", value), {
      ...job,
      id: "all-failed",
      items: [job.items[1]],
   });
   await expect(page.getByRole("button", { name: "Show in folder" })).toHaveCount(0);
   await expect(page.getByText("Export failed", { exact: true })).toBeVisible();
});
