import { test, waitForVideo } from "./app.mjs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect } from "@playwright/test";
import { hasWaveformPixels } from "./waveform-pixels.mjs";

// Run explicitly with ATTACUT_WAVEFORM_VIDEO pointing at a real recording.
// Fresh profiles clear waveform caches, not the operating system's file cache.
test("controlled waveform off, cold and warm recording benchmark", async ({ launchApp, profile }, testInfo) => {
   test.skip(!process.env.ATTACUT_WAVEFORM_VIDEO, "Opt-in real-recording benchmark");
   test.setTimeout(15 * 60 * 1000);
   const file = resolve(process.env.ATTACUT_WAVEFORM_VIDEO);
   const results = [];
   const exec = promisify(execFile);
   const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0;
   const activeProfile = join(profile, "enabled");
   for (const mode of ["off", "cold", "warm"]) {
      const directory = mode === "off" ? join(profile, "off") : activeProfile;
      await mkdir(directory, { recursive: true });
      if (mode !== "warm")
         await writeFile(
            join(directory, "settings.json"),
            JSON.stringify({ version: 1, preferences: { waveform: mode !== "off", updateCheck: false, audioScrub: false }, session: null })
         );
      const begin = Date.now();
      const app = await launchApp(directory, file);
      const page = await app.firstWindow();
      await page.evaluate(() => {
         globalThis.benchmark = { first: 0, buckets: 0, rate: 0, frames: [], pings: [], seeks: [], last: globalThis.performance.now(), stop: false };
         globalThis.desktop.onWaveformChunk((c) => {
            const s = globalThis.benchmark;
            s.first ||= globalThis.performance.now();
            if (!c.priority) s.buckets = c.offset + c.peaks.length / 3;
            s.rate = c.rate;
         });
         const frame = () => {
            const s = globalThis.benchmark;
            if (s.stop) return;
            const now = globalThis.performance.now();
            s.frames.push(now - s.last);
            s.last = now;
            globalThis.requestAnimationFrame(frame);
         };
         globalThis.requestAnimationFrame(frame);
      });
      await waitForVideo(page);
      const ready = Date.now() - begin;
      await app.evaluate(() => {
         globalThis.benchmarkMain = { last: globalThis.performance.now(), lags: [], start: process.cpuUsage() };
         globalThis.benchmarkMainTimer = globalThis.setInterval(() => {
            const s = globalThis.benchmarkMain,
               now = globalThis.performance.now();
            s.lags.push(now - s.last - 20);
            s.last = now;
         }, 20);
      });
      const metrics = [];
      let stop = false;
      let ffmpeg = null;
      const childPid = await app.evaluate(() => process.pid);
      const sampler = (async () => {
         while (!stop) {
            metrics.push(
               await app.evaluate(({ app }) =>
                  app.getAppMetrics().map((item) => ({ type: item.type, cpu: item.cpu.percentCPUUsage, rss: item.memory.workingSetSize * 1024 }))
               )
            );
            if (process.platform === "win32" && mode === "cold") {
               const command = `Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe' AND ParentProcessId=${childPid}" | Select-Object KernelModeTime,UserModeTime,ReadTransferCount,WriteTransferCount,WorkingSetSize | ConvertTo-Json -Compress`;
               const output = await exec("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
               if (output.stdout.trim()) ffmpeg = JSON.parse(output.stdout);
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
         }
      })();
      const interactions = page.evaluate(async () => {
         const v = document.querySelector("video");
         const duration = v.duration;
         const ping = async () => {
            while (!globalThis.benchmark.stop) {
               const begin = globalThis.performance.now();
               await globalThis.desktop.bootstrap();
               globalThis.benchmark.pings.push(globalThis.performance.now() - begin);
               await new Promise((resolve) => setTimeout(resolve, 100));
            }
         };
         const pings = ping();
         for (const fraction of [0.01, 0.45, 0.85, 0.15, 0.65]) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            const time = Math.min(duration - 0.5, duration * fraction);
            const begin = globalThis.performance.now();
            // Navigate through the editor so indexing and waveform pause policies participate.
            const sourceId = decodeURIComponent(new globalThis.URL(v.currentSrc).pathname.slice(1));
            const target = await globalThis.desktop.frameTime(sourceId, time, 0);
            await new Promise((resolve) => {
               v.addEventListener("seeked", resolve, { once: true });
               v.currentTime = target;
            });
            globalThis.benchmark.seeks.push(globalThis.performance.now() - begin);
         }
         await pings;
      });
      let firstPaint = 0;
      let completed = 0;
      if (mode !== "off") {
         await expect.poll(() => hasWaveformPixels(page), { timeout: 10 * 60 * 1000 }).toBe(true);
         firstPaint = Date.now() - begin;
         await page.waitForFunction(
            () => {
               const s = globalThis.benchmark;
               return s.rate && s.buckets / s.rate >= document.querySelector("video").duration - 0.02;
            },
            undefined,
            { timeout: 10 * 60 * 1000 }
         );
         completed = Date.now() - begin;
      } else await page.waitForTimeout(7000);
      // Always let the five seek measurements finish, even on a fast warm-cache load.
      await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - begin)));
      await page.evaluate(() => {
         globalThis.benchmark.stop = true;
      });
      await interactions;
      stop = true;
      await sampler;
      const renderer = await page.evaluate(() => globalThis.benchmark);
      const main = await app.evaluate(() => {
         globalThis.clearInterval(globalThis.benchmarkMainTimer);
         return { lags: globalThis.benchmarkMain.lags, cpu: process.cpuUsage(globalThis.benchmarkMain.start) };
      });
      results.push({
         mode,
         ready,
         firstPaint,
         completed,
         mainLagP95: percentile(main.lags, 0.95),
         mainLagMax: Math.max(...main.lags),
         ipcP95: percentile(renderer.pings, 0.95),
         ipcMax: Math.max(...renderer.pings),
         rafP95: percentile(renderer.frames, 0.95),
         seeks: renderer.seeks,
         mainCpuMs: (main.cpu.user + main.cpu.system) / 1000,
         peakMainRss: Math.max(
            ...metrics
               .flat()
               .filter((m) => m.type === "Browser")
               .map((m) => m.rss)
         ),
         peakRendererRss: Math.max(
            ...metrics
               .flat()
               .filter((m) => m.type === "Tab")
               .map((m) => m.rss)
         ),
         ffmpeg,
      });
      await page.screenshot({ path: testInfo.outputPath(`${mode}.png`) });
      await app.close();
   }
   const info = await stat(file);
   console.log(JSON.stringify({ size: info.size, results }, null, 2));
   await writeFile(testInfo.outputPath("waveform-benchmark.json"), JSON.stringify({ size: info.size, results }, null, 2));
});
