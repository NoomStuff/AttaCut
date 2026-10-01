import { expectAudioMatches, expectCopiedFrameMatches, expectFrameMatches, inspectMedia } from "./media-checks.mjs";
import { expect } from "@playwright/test";
import { test, waitForPlaybackTime, waitForVideo } from "./app.mjs";
import { resolve, join } from "node:path";
import { mkdir, readdir } from "node:fs/promises";

test("export workflow", async ({ launchApp, profile }) => {
   const output = join(profile, "exports");
   await mkdir(output);
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   const waitForTime = (time) => waitForPlaybackTime(page, time);
   await waitForVideo(page);
   const scrub = await page.evaluate(async () => {
      const sourceId = decodeURIComponent(new globalThis.URL(document.querySelector("video").currentSrc).pathname.replace(/^\//, ""));
      const data = await globalThis.desktop.scrubAudio(sourceId, [1]);
      return { sampleRate: data?.sampleRate, bytes: data?.pcm?.byteLength ?? 0 };
   });
   expect(scrub.sampleRate).toBe(22050);
   expect(scrub.bytes).toBeGreaterThan(22050 * 2);
   const bar = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.move(bar.x + bar.width * 0.1, bar.y + 36);
   await page.mouse.down();
   await page.mouse.move(bar.x + bar.width * 0.4, bar.y + 36, { steps: 12 });
   await page.mouse.up();
   await page.waitForFunction(() => Number(document.querySelector(".timeline-time time")?.textContent?.split(":").at(-1)) > 2.5);
   await page.mouse.click(bar.x + bar.width * 0.4, bar.y + 36);
   await waitForTime(7.2);
   await page.keyboard.press("s");
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   const end = page.getByRole("textbox", { name: "Clip end", exact: true });
   await start.fill("00:09.00");
   await start.press("Tab");
   await end.fill("00:16.00");
   await end.press("Tab");
   await page.mouse.click(bar.x + (bar.width * 12) / 18, bar.y + 36);
   await waitForTime(12);
   await page.getByRole("button", { name: "Previous cut", exact: true }).click();
   await waitForTime(9);
   await page.getByRole("button", { name: "Previous cut", exact: true }).click();
   await waitForTime(7.2);
   await page.getByRole("button", { name: "Next cut", exact: true }).click();
   await waitForTime(9);
   const originalUrl = await page.locator("video").getAttribute("src");
   await page.getByRole("button", { name: "Preview audio tracks", exact: true }).click();
   await page.getByRole("option").nth(1).click();
   await page.getByRole("option").nth(0).click();
   await expect(page.getByText(/preparing a playable preview|compatible preview/i)).toHaveCount(0);
   await expect(page.locator("video")).not.toHaveAttribute("src", originalUrl);
   await page.getByRole("button", { name: "Snap to keyframes", exact: true }).click();
   await expect(page.getByRole("button", { name: "Snap to keyframes", exact: true })).toHaveAttribute("aria-pressed", "true");
   await expect(page.locator(".keyframe-tick").first()).toBeVisible();
   const handle = page.getByRole("slider", { name: "Clip 2 start", exact: true });
   await handle.focus();
   await handle.press("ArrowRight");
   await expect(handle).toHaveAttribute("aria-valuenow", "10");
   const frameTime = await page.locator("video").evaluate((video) => video.currentTime);
   await page.getByRole("button", { name: "Export current frame", exact: true }).click();
   await page.getByRole("dialog", { name: "Export current frame", exact: true }).waitFor();
   await expect(page.locator(".frame-thumbnail")).toBeVisible();
   expect(await page.getByRole("button", { name: "Close panel" }).evaluate((button) => button === document.activeElement)).toBe(false);
   await page.getByRole("textbox", { name: "Save frame to", exact: true }).fill(output);
   await page.getByRole("textbox", { name: "Frame filename", exact: true }).fill("test-frame");
   await page.getByRole("button", { name: "Export frame", exact: true }).click();
   await page.getByRole("status").filter({ hasText: "Frame exported" }).waitFor();
   expect(await readdir(output)).toContain("test-frame.png");
   await expectFrameMatches(resolve("work/fixture.mp4"), frameTime, join(output, "test-frame.png"));
   await page.getByRole("textbox", { name: "Frame filename", exact: true }).fill("next-frame");
   await expect(page.getByRole("status").filter({ hasText: "Frame exported" })).toHaveCount(0);
   await expect(page.getByRole("button", { name: "Show file", exact: true })).toHaveCount(0);
   await page.keyboard.press("Escape");
   await page.getByRole("slider", { name: "Preview volume", exact: true }).fill("0.2");
   await page.getByRole("button", { name: "Mute preview", exact: true }).click();
   await expect(page.locator("video")).toHaveJSProperty("muted", true);
   await page.getByRole("button", { name: "Playback settings", exact: true }).click();
   await page.getByRole("switch", { name: "Play kept clips only" }).check();
   await page.keyboard.press("Escape");
   await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "detached" });
   await page.getByRole("button", { name: "Export", exact: true }).click();
   await page.getByRole("button", { name: "Single Video", exact: true }).click();
   await page.getByLabel("Save to", { exact: true }).fill(output);
   await page.getByRole("textbox", { name: "Combined filename", exact: true }).fill("joined");
   await expect(page.getByRole("button", { name: "Audio tracks to export", exact: true })).toContainText("All audio tracks");
   await expect(page.getByRole("button", { name: "Export video", exact: true })).toBeEnabled();
   await expect(page.getByText("Cut details", { exact: true })).toHaveCount(0);
   await page.getByRole("button", { name: "Export video", exact: true }).click();
   await page.getByText("Export complete", { exact: true }).waitFor({ timeout: 60000 });
   expect(await readdir(output)).toContain("joined.mp4");
   const joined = join(output, "joined.mp4");
   const media = await inspectMedia(joined);
   expect(Number(media.format.duration)).toBeCloseTo(13.2, 1);
   expect(media.streams.filter((stream) => stream.codec_type === "audio")).toHaveLength(2);
   for (const [original, result] of [
      [0.5, 0.5],
      [6.7, 6.7],
      [10.5, 7.7],
      [15.5, 12.7],
   ])
      await expectFrameMatches(resolve("work/fixture.mp4"), original, joined, result);
   await page.getByRole("button", { name: "Dismiss export status", exact: true }).click();
   for (const [original, result] of [
      [1, 1],
      [11, 8.2],
   ])
      await expectCopiedFrameMatches(resolve("work/fixture.mp4"), original, joined, result);
   for (const track of [0, 1])
      for (const [original, result] of [
         [1, 1],
         [11, 8.2],
      ])
         await expectAudioMatches(resolve("work/fixture.mp4"), original, joined, result, track);
});

test("fullscreen stays in-window and keeps playback running", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await expect(page.locator(".player-stage.fullscreen")).toHaveClass(/fullscreen/, { timeout: 5000 });
   await expect(page.locator(".fullscreen-bar")).toBeVisible();
   await expect(page.locator(".fullscreen-progress")).toBeVisible();
   const before = await page.locator("video").evaluate((video) => video.currentTime);
   await page.waitForFunction((before) => document.querySelector("video").currentTime > before + 0.3, before);
   // The clip-colored progress bar seeks; pause first so the landing spot is exact.
   await page.locator(".fullscreen-bar").getByRole("button", { name: "Pause", exact: true }).click();
   const progress = await page.locator(".fullscreen-progress").boundingBox();
   await page.mouse.click(progress.x + progress.width / 2, progress.y + progress.height / 2);
   await expect.poll(() => page.locator("video").evaluate((video) => video.currentTime)).toBeCloseTo(9, 1);
   if (process.env.ATTACUT_TEST_VISIBLE !== "1") {
      // Custom fullscreen never touches window state, so a hidden test window stays hidden.
      expect(
         await app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            return { visible: window.isVisible(), opacity: window.getOpacity(), focused: window.isFocused(), fullscreen: window.isFullScreen() };
         })
      ).toMatchObject(process.platform === "linux" ? { visible: false, focused: false } : { opacity: 0, focused: false });
   }
   await page.locator(".player-stage.fullscreen").dblclick();
   await expect(page.locator(".player-stage.fullscreen")).toHaveCount(0);
});

test("compact layout keeps transport controls within the window", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.setViewportSize({ width: 800, height: 560 });
   await expect.poll(() => page.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight])).toEqual([800, 560]);
   await expect
      .poll(async () => {
         const controls = await page.locator(".transport").boundingBox();
         return controls.y + controls.height;
      })
      .toBeLessThanOrEqual(560);
   await expect
      .poll(async () => {
         const volume = await page.getByRole("button", { name: "Playback settings", exact: true }).boundingBox();
         return volume.x + volume.width;
      })
      .toBeLessThanOrEqual(800);
});
