import { expect } from "@playwright/test";
import { appEnv, test, waitForVideo, waitForPlaybackTime } from "./app.mjs";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("background testing keeps device audio silent while input and decoded frames work", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const presentation = () =>
      app.evaluate(({ BrowserWindow }) => {
         const window = BrowserWindow.getAllWindows()[0];
         return { visible: window.isVisible(), opacity: window.getOpacity(), focused: window.isFocused(), muted: window.webContents.isAudioMuted() };
      });
   const expected =
      process.env.ATTACUT_TEST_VISIBLE === "1"
         ? { muted: true }
         : { ...(process.platform === "linux" ? { visible: false } : { opacity: 0 }), focused: false, muted: true };
   expect(await presentation()).toMatchObject(expected);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => {
      const video = document.querySelector("video");
      return video.currentTime > 0.3 && video.getVideoPlaybackQuality().totalVideoFrames > 0;
   });
   await page.getByRole("button", { name: "Pause", exact: true }).click();
   await page.keyboard.press("m");
   await expect(page.locator("video")).toHaveJSProperty("muted", true);
   await page.keyboard.press("m");
   await expect(page.locator("video")).toHaveJSProperty("muted", false);
   expect(await presentation()).toMatchObject(expected);
});

test("local diagnostics save through the real bridge without recording filenames", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const destination = resolve(profile, "diagnostics.json");
   await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
   }, destination);
   await page.evaluate(() => globalThis.window.desktop.exportDiagnostics());
   let report;
   await expect
      .poll(async () => {
         try {
            report = JSON.parse(await readFile(destination, "utf8"));
            return true;
         } catch {
            return false;
         }
      })
      .toBe(true);
   expect(report.appVersion).toMatch(/^\d+\.\d+\.\d+/);
   expect(report.tools.ffmpeg).toMatch(/^ffmpeg version/);
   expect(report.media.container).toBe(".mp4");
   expect(report.operations.some((event) => event.action === "source:open")).toBe(true);
   expect(JSON.stringify(report)).not.toContain("fixture.mp4");
   expect(JSON.stringify(report)).not.toContain(profile);
});

test("the bundled index worker reads and transfers real presentation times", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const result = await app.evaluate(async ({ app }, path) => {
      const { Worker } = process.getBuiltinModule("node:worker_threads");
      const { stat } = process.getBuiltinModule("node:fs/promises");
      const { join } = process.getBuiltinModule("node:path");
      const { pathToFileURL } = process.getBuiltinModule("node:url");
      const size = (await stat(path)).size;
      const worker = new Worker(pathToFileURL(join(app.getAppPath(), "out/main/media-index-worker.js")), {
         workerData: { path, size, extension: ".mp4", startOffset: 0, duration: 100 },
      });
      try {
         return await new Promise((resolve, reject) => {
            worker.once("error", reject);
            worker.once("message", (index) =>
               resolve(
                  index && {
                     frames: index.frames.length,
                     first: index.frames[0],
                     last: index.frames.at(-1),
                     keys: index.keyframes.length,
                     typed: index.frames instanceof Float64Array,
                  }
               )
            );
            worker.once("exit", (code) => {
               if (code) reject(new Error(`Index worker exited ${code}`));
            });
         });
      } finally {
         await worker.terminate();
      }
   }, resolve("work/fixture.mp4"));
   expect(result.typed).toBe(true);
   expect(result.first).toBe(0);
   expect(result.frames).toBeGreaterThan(100);
   expect(result.last).toBeGreaterThan(10);
   expect(result.keys).toBeGreaterThan(1);
});

test("a second process preserves active cache files and forwards file opens", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   // Instance forwarding needs an open source, not a decoded video frame.
   await expect(page.locator(".title-filename")).toContainText("fixture.mp4");
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1);
   const previewFolder = resolve(profile, "previews");
   await mkdir(previewFolder, { recursive: true });
   const marker = resolve(previewFolder, "active-preview-marker");
   await writeFile(marker, "owned by the first process");
   const executable = await app.evaluate(({ app }) => app.getPath("exe"));
   const args = process.env.ATTACUT_EXECUTABLE ? [] : ["."];
   if (process.env.CI && process.platform === "linux") args.push("--no-sandbox");
   const options = { env: { ...appEnv, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: "" }, timeout: 20000, windowsHide: true };
   await promisify(execFile)(executable, args, options);
   expect(await readFile(marker, "utf8")).toBe("owned by the first process");
   await expect(page.locator(".title-filename")).toContainText("fixture.mp4");
   await promisify(execFile)(executable, [...args, resolve("work/fixture.mkv")], options);
   await expect(page.locator(".title-filename")).toContainText("fixture.mkv");
   expect(app.windows()).toHaveLength(1);
   if (process.env.ATTACUT_TEST_VISIBLE !== "1") {
      expect(
         await app.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            return process.platform === "linux" ? !window.isVisible() : window.getOpacity() === 0 && !window.isFocused();
         })
      ).toBe(true);
   }
});

test("desktop failures retain their code and diagnostics through the preload bridge", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
   const failure = await page.evaluate(async () => {
      try {
         await globalThis.desktop.frameTime("missing-source", 0, 0);
         return null;
      } catch (error) {
         return error;
      }
   });
   expect(failure).toMatchObject({
      kind: "attacut-error",
      code: "media",
      retryable: false,
      message: "Reopen the source video.",
      detail: "Reopen the source video.",
   });
});

test("playback leaves the root idle and close flushes the final edit", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   let page = await app.firstWindow();
   await waitForVideo(page);
   await page.addInitScript(() => {
      globalThis.rootRenders = 0;
      const observer = new globalThis.PerformanceObserver((list) => {
         globalThis.rootRenders += list.getEntries().filter((entry) => entry.name === "attacut:editor-commit").length;
      });
      observer.observe({ type: "mark", buffered: true });
   });
   let savedSession;
   await expect
      .poll(async () => {
         savedSession = await page.evaluate(async () => (await globalThis.desktop.bootstrap()).session);
         return !!savedSession?.path;
      })
      .toBe(true);
   await page.evaluate(async (session) => {
      const clips = Array.from({ length: 500 }, (_, index) => ({
         id: `stress-${index}`,
         color: index % 5,
         start: index === 0 ? 0 : 9 + ((index - 1) * 9) / 499,
         end: index === 0 ? 9 : 9 + (index * 9) / 499,
      }));
      await globalThis.desktop.saveSession({ ...session, clips, selectedId: clips[0].id, past: [], future: [] });
   }, savedSession);
   await page.reload();
   await waitForVideo(page);
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(500);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 0.3);
   const before = await page.evaluate(() => ({ roots: globalThis.rootRenders }));
   await page.waitForFunction(() => document.querySelector("video").currentTime > 2.3);
   const after = await page.evaluate(() => ({ roots: globalThis.rootRenders }));
   // Headless CI can throttle animation frames heavily. Playback progress is
   // checked above; this only needs commits to show React updated during it.
   expect(before.roots).toBeGreaterThan(0);
   expect(after.roots - before.roots).toBeLessThanOrEqual(2);
   console.log(`Editor commits during playback: ${after.roots - before.roots}`);
   await page.getByRole("button", { name: "Pause", exact: true }).click();
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("00:01.30");
   await start.press("Tab");
   // Close before the debounced effect writes; the close handshake must supply this edit.
   await app.close();
   const settings = JSON.parse(await readFile(resolve(profile, "session.json"), "utf8"));
   expect(settings.session.clips[0].start).toBe(1.3);
   const restored = await launchApp(profile, "");
   page = await restored.firstWindow();
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "1.3");
});

test("handle drafts update the transport without rendering the root and Escape restores the cut", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   const slider = page.getByRole("slider", { name: "Clip 1 start", exact: true });
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   const handle = await slider.boundingBox();
   const y = handle.y + handle.height / 2;
   await page.mouse.move(handle.x + handle.width / 2, y);
   await page.mouse.down();
   await page.mouse.move(viewport.x + viewport.width / 18, y);
   await expect(start).toHaveValue("00:01.00");
   await page.evaluate(() => {
      globalThis.dragRootRenders = 0;
      const observer = new globalThis.PerformanceObserver((list) => {
         globalThis.dragRootRenders += list.getEntries().filter((entry) => entry.name === "attacut:editor-commit").length;
      });
      observer.observe({ type: "mark" });
   });
   await page.mouse.move(viewport.x + (viewport.width * 3) / 18, y, { steps: 20 });
   await expect(start).toHaveValue("00:03.00");
   const renders = await page.evaluate(() => globalThis.dragRootRenders);
   expect(renders).toBeLessThanOrEqual(2);
   console.log(`Editor commits during handle drag: ${renders}`);
   await page.keyboard.press("Escape");
   await page.mouse.up();
   await expect(slider).toHaveAttribute("aria-valuenow", "0");
   await expect(start).toHaveValue("00:00.00");
});

test("the clip limit explains rejected edits and allows editing again after a deletion", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await expect.poll(async () => !!(await page.evaluate(() => globalThis.desktop.bootstrap())).session).toBe(true);
   await page.evaluate(async () => {
      const { session } = await globalThis.desktop.bootstrap();
      const clips = Array.from({ length: 1000 }, (_, index) => ({
         id: `limit-${index}`,
         color: index % 5,
         start: index === 0 ? 0 : 9 + ((index - 1) * 9) / 999,
         end: index === 0 ? 7 : 9 + (index * 9) / 999,
      }));
      await globalThis.desktop.saveSession({ ...session, clips, selectedId: clips[0].id, past: [], future: [] });
   });
   await page.reload();
   await waitForVideo(page);
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1000);
   await page.keyboard.press("ArrowRight");
   await waitForPlaybackTime(page, 1);
   await page.keyboard.press("s");
   const warning = page.getByText("This timeline has reached 1,000 clips. Merge or delete a clip before adding another.");
   await expect(warning).toBeVisible();
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1000);
   await page.getByRole("button", { name: "Dismiss error", exact: true }).click();
   await page.locator(".title-filename").click();
   for (let step = 0; step < 7; step++) await page.keyboard.press("ArrowRight");
   await waitForPlaybackTime(page, 8);
   await page.keyboard.press("w");
   await expect(warning).toBeVisible();
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1000);
   await page.getByRole("button", { name: "Dismiss error", exact: true }).click();
   await page.locator(".title-filename").click();
   for (let step = 0; step < 7; step++) await page.keyboard.press("ArrowLeft");
   await waitForPlaybackTime(page, 1);
   await page.keyboard.press("Delete");
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(999);
   await page.keyboard.press("w");
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1000);
   await page.keyboard.press("ControlOrMeta+z");
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(999);
   await page.keyboard.press("ControlOrMeta+Shift+z");
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1000);
   await app.close();
   const saved = JSON.parse(await readFile(resolve(profile, "session.json"), "utf8"));
   expect(saved.session.clips).toHaveLength(1000);
   expect(saved.session.history.past).toHaveLength(2);
});
