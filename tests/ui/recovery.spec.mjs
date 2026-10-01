import { expect } from "@playwright/test";
import { test, waitForVideo, configureIpc } from "./app.mjs";
import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function open(app, path) {
   await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
}

test("a failed replacement import preserves the current project and permits recovery", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.getByRole("textbox", { name: "Clip start", exact: true }).fill("00:02.00");
   await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
   const broken = join(profile, "broken.mp4");
   await writeFile(broken, "not a video");
   await open(app, broken);
   await expect(page.getByRole("status")).toContainText("doesn't look like a working video");
   await expect(page.locator(".title-filename")).toHaveText("fixture.mp4");
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "2");
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 2.3);
   await page.getByRole("button", { name: "Pause", exact: true }).click();
   await open(app, resolve("work/fixture.mkv"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await waitForVideo(page);
});

test("a delayed open result cannot replace the newer project", async ({ launchApp, profile }) => {
   test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development fault injection");
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Import video", exact: true }).waitFor();
   await configureIpc(app, "source:open", { after: "old-open" });
   await open(app, resolve("work/fixture.mp4"));
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("old-open"))).toBe(true);
   await configureIpc(app, "source:open", {});
   await open(app, resolve("work/fixture.mkv"));
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await waitForVideo(page);
   await app.evaluate(() => globalThis.attacutTestIpc.release("old-open"));
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.ready("source:open"))).toBe(true);
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 0.3);
   await expect(page.locator(".title-filename")).toHaveText("fixture.mkv");
});

test("restart with a missing source explains the problem and allows a new import", async ({ launchApp, profile }) => {
   const path = join(profile, "moved.mp4");
   await copyFile(resolve("work/fixture.mp4"), path);
   const app = await launchApp(profile, path);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await app.close();
   const saved = JSON.parse(await readFile(join(profile, "session.json"), "utf8"));
   expect(saved.session.path).toBe(path);
   await rm(path);
   const restored = await launchApp(profile, "");
   const next = await restored.firstWindow();
   await expect(next.getByRole("status")).toContainText("can't be found");
   await expect(next.getByRole("button", { name: "Import video", exact: true })).toBeEnabled();
   await open(restored, resolve("work/fixture.mp4"));
   await waitForVideo(next);
   await expect(next.locator(".title-filename")).toHaveText("fixture.mp4");
});

for (const changed of [true, false])
   test(`planned export refuses a ${changed ? "changed" : "removed"} source`, async ({ launchApp, profile }) => {
      const source = join(profile, "source.mp4");
      await copyFile(resolve("work/fixture.mp4"), source);
      const app = await launchApp(profile, source);
      const page = await app.firstWindow();
      await waitForVideo(page);
      const plan = await page.evaluate(async (directory) => {
         const sourceId = decodeURIComponent(new globalThis.URL(document.querySelector("video").currentSrc).pathname.slice(1));
         return globalThis.desktop.planExport({ sourceId, directory, items: [{ name: "refused", clip: { id: "whole", color: 0, start: 0, end: 18 } }] });
      }, profile);
      const existing = join(profile, "preserved.mp4");
      await writeFile(existing, "existing video");
      if (changed) await writeFile(source, "changed");
      else await rm(source);
      await page.evaluate((id) => globalThis.desktop.startExport(id), plan.id);
      await expect(page.getByText("Export failed", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toContainText(/reopen|can't be found|no such file/i);
      expect(await readFile(existing, "utf8")).toBe("existing video");
      await expect(readFile(plan.items[0].outputPath)).rejects.toThrow();
      await copyFile(resolve("work/fixture.mp4"), source);
      await app.evaluate(({ dialog }, path) => {
         dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, source);
      await page.getByRole("button", { name: "Reopen source", exact: true }).click();
      await waitForVideo(page);
      await expect(page.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
   });
