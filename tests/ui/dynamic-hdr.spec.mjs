import { expect } from "@playwright/test";
import { test, waitForVideo, mediaBinary } from "./app.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

test("real HDR10+ boundaries explain refusal and disable export", async ({ launchApp, profile }) => {
   await promisify(execFile)("bun", ["tests/media/dynamic-hdr.ts"], {
      windowsHide: true,
      env: { ...process.env, FFMPEG_PATH: mediaBinary("ffmpeg"), FFPROBE_PATH: mediaBinary("ffprobe") },
   });
   const path = resolve("work/dynamic-hdr/hdr10plus.mp4");
   const original = await readFile(path);
   const app = await launchApp(profile, path);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.getByRole("textbox", { name: "Clip start", exact: true }).fill("00:00.30");
   await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
   await page.getByRole("textbox", { name: "Clip end", exact: true }).fill("00:03.70");
   await page.getByRole("textbox", { name: "Clip end", exact: true }).press("Tab");
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await expect(page.getByText(/This file uses dynamic HDR metadata/)).toBeVisible();
   await expect(page.getByRole("button", { name: "Export video", exact: true })).toBeDisabled();
   expect(await readFile(path)).toEqual(original);
});
