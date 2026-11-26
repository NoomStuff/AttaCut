import { expect } from "@playwright/test";
import { test, waitForVideo } from "./app.mjs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

test("a file that cannot go to the Recycle Bin is never replaced", async ({ launchApp, profile }) => {
   const source = join(profile, "source.mp4");
   await copyFile(resolve("work/fixture.mp4"), source);
   const existing = join(profile, "kept.mp4");
   await writeFile(existing, "existing video");
   const app = await launchApp(profile, source, { env: { ATTACUT_TEST_TRASH: "removable" } });
   const page = await app.firstWindow();
   await waitForVideo(page);
   const request = await page.evaluate((directory) => {
      const sourceId = decodeURIComponent(new globalThis.URL(document.querySelector("video").currentSrc).pathname.slice(1));
      return { sourceId, directory, mode: "combined", name: "kept", items: [{ name: "kept", clip: { id: "part", color: 0, start: 1, end: 4 } }] };
   }, profile);
   const destinations = await page.evaluate((value) => globalThis.desktop.checkExportDestinations(value), request);
   expect(destinations.items[0]).toMatchObject({ danger: true, conflict: expect.stringContaining("drive without a Recycle Bin") });
   const plan = await page.evaluate((value) => globalThis.desktop.planExport(value), request);
   await page.evaluate((id) => globalThis.desktop.startExport(id, { overwrite: true }), plan.id);
   await expect(page.getByText("Export failed", { exact: true })).toBeVisible({ timeout: 30000 });
   await expect(page.locator(".job-failure-item")).toContainText("so AttaCut won't replace it");
   expect(await readFile(existing, "utf8")).toBe("existing video");
});
