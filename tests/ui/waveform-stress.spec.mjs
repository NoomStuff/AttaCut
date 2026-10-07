import { test, waitForVideo, mediaBinary } from "./app.mjs";
import { expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

test("maximum clip count remains responsive during waveform load and view changes", async ({ launchApp, profile }, testInfo) => {
   test.skip(!process.env.ATTACUT_PERFORMANCE_VIDEO, "Opt-in recording stress test");
   test.setTimeout(15 * 60 * 1000);
   const source = resolve(process.env.ATTACUT_PERFORMANCE_VIDEO);
   const info = await stat(source);
   const duration = Number(
      JSON.parse(execFileSync(mediaBinary("ffprobe"), ["-v", "error", "-show_format", "-of", "json", source], { windowsHide: true })).format.duration
   );
   const clips = Array.from({ length: 1000 }, (_, i) => ({
      id: `clip-${i}`,
      color: i,
      start: (i * duration) / 1000,
      end: ((i + 1) * duration) / 1000 - 0.05,
   }));
   const project = join(profile, "stress.attacut");
   await writeFile(
      project,
      JSON.stringify({
         format: "AttaCut",
         version: 2,
         relativeSource: relative(profile, source).replaceAll("\\", "/"),
         session: { path: source, size: info.size, modified: info.mtimeMs, clips, selectedId: clips[0].id, history: { version: 1, past: [], future: [] } },
      })
   );
   const runs = [];
   for (const enabled of [false, true]) {
      const directory = join(profile, enabled ? "on" : "off");
      await mkdir(directory, { recursive: true });
      await writeFile(
         join(directory, "settings.json"),
         JSON.stringify({ version: 1, preferences: { waveform: enabled, audioScrub: false, updateCheck: false }, session: null })
      );
      if (enabled && process.env.ATTACUT_PERFORMANCE_CACHE) {
         const cache = join(directory, "waveforms");
         await mkdir(cache, { recursive: true });
         for (const file of await readdir(process.env.ATTACUT_PERFORMANCE_CACHE))
            if (file.endsWith(".wave")) await copyFile(join(process.env.ATTACUT_PERFORMANCE_CACHE, file), join(cache, file));
      }
      const app = await launchApp(directory, "");
      // Frame alignment can change synthetic project boundaries. Discard those
      // test-only edits when closing this isolated profile.
      await app.evaluate(({ dialog }) => {
         dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
      });
      const page = await app.firstWindow();
      await page.evaluate(() => {
         globalThis.stress = { tasks: [], ticks: [], last: globalThis.performance.now(), stop: false, buckets: 0, rate: 0 };
         globalThis.stress.frames = [];
         new globalThis.PerformanceObserver((list) => globalThis.stress.tasks.push(...list.getEntries().map((e) => e.duration))).observe({
            type: "longtask",
            buffered: true,
         });
         globalThis.desktop.onWaveformChunk((chunk) => {
            if (chunk.priority) return;
            globalThis.stress.buckets = chunk.offset + chunk.peaks.length / 3;
            globalThis.stress.rate = chunk.rate;
         });
      });
      await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", file), project);
      await waitForVideo(page);
      await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1000);
      await page.evaluate(() => {
         const sample = () => {
            const s = globalThis.stress;
            s.ticks.push(globalThis.performance.now() - s.last - 20);
            s.last = globalThis.performance.now();
            const v = document.querySelector("video");
            const quality = v.getVideoPlaybackQuality();
            if (!s.frames.length || s.last - s.frames[s.frames.length - 1].time > 500)
               s.frames.push({ time: s.last, mediaTime: v.currentTime, total: quality.totalVideoFrames, dropped: quality.droppedVideoFrames });
            if (!s.stop) setTimeout(sample, 20);
         };
         globalThis.stress.last = globalThis.performance.now();
         sample();
         document.querySelector('button[aria-label="Play"]').click();
      });
      await page.waitForFunction(() => document.querySelector("video").currentTime > 5);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const box = await page.locator(".timeline-viewport").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 35);
      for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -200);
      for (let i = 0; i < 4; i++) await page.mouse.wheel(i % 2 ? -300 : 300, 0);
      await page.getByRole("button", { name: "Fit timeline", exact: true }).click();
      if (enabled)
         await page.waitForFunction(
            () => {
               const s = globalThis.stress;
               return s.rate && s.buckets / s.rate >= document.querySelector("video").duration - 0.02;
            },
            undefined,
            { timeout: 10 * 60 * 1000 }
         );
      await page.waitForTimeout(1000);
      const metrics = await page.evaluate(() => {
         globalThis.stress.stop = true;
         const v = document.querySelector("video");
         const quality = v.getVideoPlaybackQuality();
         return {
            ...globalThis.stress,
            totalFrames: quality.totalVideoFrames,
            droppedFrames: quality.droppedVideoFrames,
            canvasCount: document.querySelectorAll(".clip-waveform").length,
         };
      });
      await page.screenshot({ path: testInfo.outputPath(enabled ? "waveforms.png" : "off.png") });
      runs.push({ enabled, metrics });
      await app.close();
   }
   await writeFile(testInfo.outputPath("waveform-stress.json"), JSON.stringify(runs, null, 2));
   const off = runs[0].metrics;
   const on = runs[1].metrics;
   expect(on.canvasCount).toBe(1);
   // Relative to the control run, allow five percent for decoder/startup noise.
   // This rejects the GPU canvas experiment's 33-47 dropped frames in five seconds.
   expect(on.droppedFrames - off.droppedFrames).toBeLessThanOrEqual(Math.max(5, on.totalFrames * 0.05));
   console.log(
      JSON.stringify(
         runs.map(({ enabled, metrics: m }) => ({
            enabled,
            longTasks: m.tasks,
            maxTickDelay: Math.max(...m.ticks),
            totalFrames: m.totalFrames,
            dropped: m.droppedFrames,
            canvases: m.canvasCount,
         })),
         null,
         2
      )
   );
});
