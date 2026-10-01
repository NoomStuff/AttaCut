import { expectCopiedFrameMatches, expectFrameMatches } from "./media-checks.mjs";
import { expect } from "@playwright/test";
import { mediaBinary, test, waitForVideo } from "./app.mjs";
import { resolve, join } from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("edit, export and restore the selected ranges", async ({ launchApp, profile }) => {
   const output = join(profile, "exports");
   await mkdir(output);
   const original = await readFile(resolve("work/fixture.mp4"));
   const application = await launchApp(profile, resolve("work/fixture.mp4"));
   let page = await application.firstWindow();
   await page.getByRole("slider", { name: "Clip 1 start", exact: true }).waitFor();
   await waitForVideo(page);
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
   await expect.poll(async () => Number(await second.getAttribute("aria-valuenow"))).toBeCloseTo(9.7, 6);
   await start.fill("00:10.20");
   await start.press("Tab");
   await expect.poll(async () => Number(await second.getAttribute("aria-valuenow"))).toBeCloseTo(10.2, 6);
   await start.fill("00:12.00");
   await start.press("Escape");
   await expect(start).toHaveValue("00:10.20");
   await expect.poll(async () => Number(await second.getAttribute("aria-valuenow"))).toBeCloseTo(10.2, 6);
   const box = await second.boundingBox();
   await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
   await page.mouse.down();
   await page.mouse.move(box.x + 75, box.y + 10, { steps: 5 });
   await page.keyboard.press("Escape");
   await page.mouse.up();
   await expect.poll(async () => Number(await second.getAttribute("aria-valuenow"))).toBeCloseTo(10.2, 6);
   await page.keyboard.press("ControlOrMeta+z");
   await expect.poll(async () => Number(await second.getAttribute("aria-valuenow"))).toBeCloseTo(9.7, 6);
   await page.keyboard.press("ControlOrMeta+Shift+z");
   await expect.poll(async () => Number(await second.getAttribute("aria-valuenow"))).toBeCloseTo(10.2, 6);
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("dialog", { name: "Export clips" }).waitFor();
   await expect(page.getByRole("textbox", { name: "Clip 1 filename", exact: true })).toHaveValue("fixture (1)");
   await expect(page.getByRole("textbox", { name: "Clip 2 filename", exact: true })).toHaveValue("fixture (2)");
   await page.getByLabel("Save to", { exact: true }).fill(output);
   const exportButton = page.getByRole("button", { name: "Export 2 clips", exact: true });
   await expect(exportButton).toBeEnabled({ timeout: 20000 });
   await exportButton.click();
   await page.getByText("Export complete", { exact: true }).waitFor({ timeout: 30000 });
   const outputs = (await readdir(output)).filter((name) => name.endsWith(".mp4")).sort();
   expect(outputs).toEqual(["fixture (1).mp4", "fixture (2).mp4"]);
   for (const [index, name] of outputs.entries()) {
      const { stdout } = await promisify(execFile)(
         mediaBinary("ffprobe"),
         ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", join(output, name)],
         { windowsHide: true }
      );
      const media = JSON.parse(stdout);
      const beginning = [1.3, 10.2][index];
      const copiedOffset = [3, 2.5][index];
      await expectCopiedFrameMatches(resolve("work/fixture.mp4"), beginning + copiedOffset, join(output, name), copiedOffset);
      for (const offset of [0.5, [8.4, 4.5][index] - 0.5])
         await expectFrameMatches(resolve("work/fixture.mp4"), beginning + offset, join(output, name), offset);
      expect(Number(media.format.duration)).toBeCloseTo([8.4, 4.5][index], 1);
      expect(media.streams.filter((stream) => stream.codec_type === "audio")).toHaveLength(2);
      expect(media.streams.filter((stream) => stream.codec_type === "video")).toHaveLength(1);
   }
   expect(await readFile(resolve("work/fixture.mp4"))).toEqual(original);
   await page.getByRole("button", { name: "Dismiss export status" }).click();
   await application.close();
   const restored = await launchApp(profile, "");
   page = await restored.firstWindow();
   await expect
      .poll(async () => Number(await page.getByRole("slider", { name: "Clip 2 start", exact: true }).getAttribute("aria-valuenow")))
      .toBeCloseTo(10.2, 6);
   console.log("Session restoration passed.");
});
