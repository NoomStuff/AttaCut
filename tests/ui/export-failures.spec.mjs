import { expect } from "@playwright/test";
import { test, configureIpc, waitForVideo } from "./app.mjs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

async function heldJob(app, page, profile) {
   await configureIpc(app, "test:export-item", { before: "first-item" });
   const plan = await page.evaluate(async (directory) => {
      const sourceId = decodeURIComponent(new globalThis.URL(document.querySelector("video").currentSrc).pathname.slice(1));
      return globalThis.desktop.planExport({
         sourceId,
         directory,
         items: [
            { name: "first", clip: { id: "a", color: 0, start: 1.3, end: 6.7 } },
            { name: "second", clip: { id: "b", color: 1, start: 9.2, end: 14.7 } },
         ],
      });
   }, profile);
   await page.evaluate((id) => globalThis.desktop.startExport(id), plan.id);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("first-item"))).toBe(true);
   await configureIpc(app, "test:export-item", { before: "second-item" });
   await app.evaluate(() => globalThis.attacutTestIpc.release("first-item"));
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("second-item")), { timeout: 60000 }).toBe(true);
   expect((await readFile(plan.items[0].outputPath)).length).toBeGreaterThan(1000);
   return plan;
}

test("a real partial export retains the completed file and reports a collision", async ({ launchApp, profile }) => {
   test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development work gate");
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const plan = await heldJob(app, page, profile);
   const completed = await readFile(plan.items[0].outputPath);
   await writeFile(plan.items[1].outputPath, "existing file created after planning");
   await app.evaluate(() => globalThis.attacutTestIpc.release("second-item"));
   await expect(page.getByText("1 file exported", { exact: true })).toBeVisible();
   await expect(page.getByText("Export failed", { exact: true })).toBeVisible();
   expect(await readFile(plan.items[0].outputPath)).toEqual(completed);
   expect(await readFile(plan.items[1].outputPath, "utf8")).toBe("existing file created after planning");
   expect((await readdir(profile)).some((name) => name.startsWith(".attacut-"))).toBe(false);
});

for (const cancel of [false, true])
   test(`close during export: ${cancel ? "cancel and close" : "keep exporting"}`, async ({ launchApp, profile }) => {
      test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development work gate");
      const app = await launchApp(profile, resolve("work/fixture.mp4"));
      const page = await app.firstWindow();
      await waitForVideo(page);
      const plan = await heldJob(app, page, profile);
      const completed = await readFile(plan.items[0].outputPath);
      await page.getByRole("textbox", { name: "Clip start", exact: true }).fill("00:02.00");
      await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
      const child = app.process();
      await app.evaluate(({ dialog }, cancel) => {
         dialog.showMessageBox = async (_window, options) => {
            globalThis.closePrompt = options;
            return { response: cancel ? 1 : 0 };
         };
      }, cancel);
      await page.evaluate(() => globalThis.desktop.windowAction("close"));
      if (cancel) await expect.poll(() => child.exitCode).toBe(0);
      else {
         await expect.poll(() => app.evaluate(() => globalThis.closePrompt?.buttons)).toEqual(["Keep exporting", "Cancel and close"]);
         expect(page.isClosed()).toBe(false);
         await app.evaluate(() => globalThis.attacutTestIpc.release("second-item"));
         await expect(page.getByText("Export complete", { exact: true })).toBeVisible({ timeout: 60000 });
         await app.close();
      }
      expect(await readFile(plan.items[0].outputPath)).toEqual(completed);
      if (cancel) await expect(readFile(plan.items[1].outputPath)).rejects.toMatchObject({ code: "ENOENT" });
      else expect((await readFile(plan.items[1].outputPath)).length).toBeGreaterThan(1000);
      expect((await readdir(profile)).some((name) => name.startsWith(".attacut-"))).toBe(false);
      const state = JSON.parse(await readFile(join(profile, "session.json"), "utf8"));
      expect(state.session.clips[0].start).toBe(2);
   });
