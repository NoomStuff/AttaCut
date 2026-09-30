import { expect } from "@playwright/test";
import { appEnv, test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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
});

test("desktop failures retain their code and diagnostics through the preload bridge", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await page.getByRole("button", { name: "Import video", exact: true }).waitFor();
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
