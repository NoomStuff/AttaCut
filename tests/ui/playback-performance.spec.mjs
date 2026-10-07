import { test, waitForVideo } from "./app.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

// Real input, fresh application cache, unchanged operating-system file cache.
test("recording play response and rapid scrub under waveform load", async ({ launchApp, profile }, testInfo) => {
   test.skip(!process.env.ATTACUT_PERFORMANCE_VIDEO, "Opt-in recording benchmark");
   test.setTimeout(15 * 60 * 1000);
   const results = [];
   const enabled = join(profile, "enabled");
   for (const mode of (process.env.ATTACUT_PERFORMANCE_MODES ?? "off,cold,warm").split(",")) {
      const directory = mode === "off" ? join(profile, "off") : enabled;
      await mkdir(directory, { recursive: true });
      if (mode !== "warm")
         await writeFile(
            join(directory, "settings.json"),
            JSON.stringify({ version: 1, preferences: { waveform: mode !== "off", updateCheck: false, audioScrub: true }, session: null })
         );
      const start = Date.now();
      const app = await launchApp(directory, resolve(process.env.ATTACUT_PERFORMANCE_VIDEO));
      const page = await app.firstWindow();
      await page.evaluate(() => {
         globalThis.perfRun = { longTasks: [], completed: false, peakEnd: 0, rate: 0, events: [] };
         for (const type of ["play", "playing", "pause", "waiting", "canplay", "seeking", "seeked"])
            document.addEventListener(
               type,
               (event) => {
                  const v = event.target;
                  if (v instanceof globalThis.HTMLVideoElement)
                     globalThis.perfRun.events.push({ type, time: globalThis.performance.now(), seeking: v.seeking, paused: v.paused });
               },
               true
            );
         new globalThis.PerformanceObserver((list) => globalThis.perfRun.longTasks.push(...list.getEntries().map((e) => e.duration))).observe({
            type: "longtask",
            buffered: true,
         });
         globalThis.desktop.onWaveformChunk((chunk) => {
            if (chunk.priority) return;
            globalThis.perfRun.peakEnd = chunk.offset + chunk.peaks.length / 3;
            globalThis.perfRun.rate = chunk.rate;
         });
      });
      await waitForVideo(page);
      const ready = Date.now() - start;
      // Give a cold extraction a chance to start before exercising playback.
      await page.waitForTimeout(1500);
      const measurements = await page.evaluate(async () => {
         const video = document.querySelector("video");
         const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
         const plays = [];
         const scrubs = [];
         const withTimeout = (promise) =>
            Promise.race([
               promise,
               sleep(10000).then(() => {
                  throw new Error("No target video frame within 10 seconds");
               }),
            ]);
         const seekTo = async (fraction, burst = false) => {
            const bar = document.querySelector(".timeline-viewport");
            const bounds = bar.getBoundingClientRect();
            const target = video.duration * fraction;
            const start = globalThis.performance.now();
            const frame = withTimeout(
               new Promise((resolve) => {
                  const watch = (_, metadata) => {
                     if (Math.abs(metadata.mediaTime - target) < 0.1) resolve(globalThis.performance.now() - start);
                     else video.requestVideoFrameCallback(watch);
                  };
                  video.requestVideoFrameCallback(watch);
               })
            );
            const pointer = (type, f, buttons) =>
               bar.dispatchEvent(
                  new globalThis.PointerEvent(type, {
                     bubbles: true,
                     pointerId: 1,
                     pointerType: "mouse",
                     clientX: bounds.x + bounds.width * f,
                     clientY: bounds.y + 36,
                     button: 0,
                     buttons,
                  })
               );
            pointer("pointerdown", burst ? 0.05 : fraction, 1);
            if (burst)
               for (let i = 0; i < 24; i++) {
                  pointer("pointermove", i % 2 ? 0.82 : 0.12, 1);
                  await sleep(8);
               }
            const final = globalThis.performance.now();
            pointer("pointermove", fraction, 1);
            pointer("pointerup", fraction, 0);
            const elapsed = await frame;
            return { elapsed, afterLastInput: elapsed - (final - start), landed: video.currentTime, target };
         };
         for (let round = 0; round < 8; round++) {
            if (round) scrubs.push(await seekTo([0.1, 0.72, 0.35, 0.85, 0.2, 0.65, 0.4][round - 1], round % 2 === 1));
            await sleep(250);
            const initial = video.currentTime;
            let seeks = 0;
            const countSeek = () => seeks++;
            video.addEventListener("seeking", countSeek);
            const begin = globalThis.performance.now();
            const frame = withTimeout(
               new Promise((resolve) => {
                  const next = (_, metadata) => {
                     if (metadata.mediaTime > initial + 0.01) resolve(globalThis.performance.now() - begin);
                     else video.requestVideoFrameCallback(next);
                  };
                  video.requestVideoFrameCallback(next);
               })
            );
            document.querySelector('button[aria-label="Play"]').click();
            const firstFrame = await frame;
            await sleep(2000);
            document.querySelector('button[aria-label="Pause"]').click();
            video.removeEventListener("seeking", countSeek);
            plays.push({ firstFrame, seeks });
         }
         return {
            plays,
            scrubs,
            quality: video.getVideoPlaybackQuality().toJSON?.() ?? {
               total: video.getVideoPlaybackQuality().totalVideoFrames,
               dropped: video.getVideoPlaybackQuality().droppedVideoFrames,
            },
         };
      });
      if (mode !== "off")
         await page
            .waitForFunction(
               () => {
                  const s = globalThis.perfRun;
                  return s.rate && s.peakEnd / s.rate >= document.querySelector("video").duration - 0.02;
               },
               undefined,
               { timeout: 3 * 60 * 1000 }
            )
            .catch(async (error) => {
               const renderer = await page.evaluate(() => ({
                  ...globalThis.perfRun,
                  video: {
                     seeking: document.querySelector("video").seeking,
                     paused: document.querySelector("video").paused,
                     readyState: document.querySelector("video").readyState,
                  },
                  canvasCount: document.querySelectorAll(".clip-waveform").length,
               }));
               const counts = await app.evaluate(() =>
                  Object.fromEntries(
                     ["waveform:start", "waveform:activity", "waveform:cancel", "source:frame-time", "audio:scrub", "audio:cancel"].map((key) => [
                        key,
                        { count: globalThis.attacutTestIpc.count(key), ready: globalThis.attacutTestIpc.ready(key) },
                     ])
                  )
               );
               console.log(JSON.stringify({ mode, renderer, counts, measurements }, null, 2));
               const diagnostic = testInfo.outputPath("stalled-diagnostics.json");
               await app.evaluate(({ dialog }, file) => {
                  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
               }, diagnostic);
               await page.evaluate(() => globalThis.desktop.exportDiagnostics());
               console.log(await readFile(diagnostic, "utf8"));
               await writeFile(testInfo.outputPath("stalled-performance.json"), JSON.stringify({ mode, renderer, counts, measurements }, null, 2));
               throw error;
            });
      const completed = Date.now() - start;
      const renderer = await page.evaluate(() => globalThis.perfRun);
      results.push({ mode, ready, completed, ...measurements, longTasks: renderer.longTasks });
      if (mode !== "off") {
         const diagnostic = testInfo.outputPath(`waveform-diagnostics-${mode}.json`);
         await app.evaluate(({ dialog }, file) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
         }, diagnostic);
         await page.evaluate(() => globalThis.desktop.exportDiagnostics());
      }
      await app.close();
   }
   console.log(JSON.stringify(results, null, 2));
   await writeFile(testInfo.outputPath("playback-performance.json"), JSON.stringify(results, null, 2));
});
