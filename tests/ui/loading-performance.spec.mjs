import { expect } from "@playwright/test";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { test, waitForVideo } from "./app.mjs";

async function report(testInfo, name, value) {
   const path = testInfo.outputPath(`${name}.json`);
   const record = { variant: process.env.ATTACUT_BENCHMARK_VARIANT ?? "optimized", data: value };
   const body = JSON.stringify(record, null, 2);
   await writeFile(path, body);
   await testInfo.attach(name, { path, contentType: "application/json" });
   console.log(`${name}: ${JSON.stringify(record)}`);
}

const variants = process.env.ATTACUT_BASELINE_ENTRY ? ["baseline", "optimized"] : ["optimized"];
for (const variant of variants) {
   test.describe(variant, () => {
      test.beforeEach(() => {
         process.env.ATTACUT_BENCHMARK_VARIANT = variant;
         if (variant === "baseline") process.env.ATTACUT_TEST_ENTRY = process.env.ATTACUT_BASELINE_ENTRY;
         else delete process.env.ATTACUT_TEST_ENTRY;
      });

      // Keep the input and OS file cache constant. Each test starts with fresh app caches.
      // Report timings instead of asserting a hardware-dependent millisecond threshold.
      test("measure source opening through a decoded frame and editable timeline", async ({ launchApp, profile }, testInfo) => {
         const app = await launchApp(profile, "");
         const page = await app.firstWindow();
         await page.getByRole("button", { name: "Open file", exact: true }).waitFor();
         const path = resolve(process.env.ATTACUT_PERFORMANCE_VIDEO ?? "work/fixture.mp4");
         const measurements = [];
         for (let run = 0; run < 6; run++) {
            const previousUrl = await page.evaluate(() => document.querySelector("video")?.getAttribute("src") ?? null);
            await page.evaluate(() => {
               globalThis.openingTiming = { started: globalThis.performance.now(), decodedMs: null };
               document.addEventListener(
                  "loadeddata",
                  () => {
                     globalThis.openingTiming.decodedMs = globalThis.performance.now() - globalThis.openingTiming.started;
                  },
                  { capture: true, once: true }
               );
            });
            const started = performance.now();
            await app.evaluate(({ BrowserWindow }, path) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", path), path);
            await expect(page.locator(".player-stage video")).toHaveAttribute("src", /media:\/\/source\//);
            await expect.poll(() => page.locator(".player-stage video").getAttribute("src")).not.toBe(previousUrl);
            await waitForVideo(page);
            await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toBeVisible();
            await expect(page.getByRole("textbox", { name: "Clip start", exact: true })).toBeEditable();
            measurements.push({
               run,
               cache: run === 0 ? "cold" : "warm",
               readyMs: performance.now() - started,
               decodedMs: await page.evaluate(() => globalThis.openingTiming.decodedMs),
            });
         }
         await report(testInfo, "source-opening-times", { path, measurements });
      });

      test("measure startup with a recording passed by the launcher", async ({ launchApp, profile }, testInfo) => {
         const started = performance.now();
         const app = await launchApp(profile, resolve(process.env.ATTACUT_PERFORMANCE_VIDEO ?? "work/fixture.mp4"));
         const page = await app.firstWindow();
         await waitForVideo(page);
         await expect(page.getByRole("textbox", { name: "Clip start", exact: true })).toBeEditable();
         await report(testInfo, "startup-opening-time", { readyMs: performance.now() - started });
      });

      test("repeatedly restore the last edit without losing clips", async ({ launchApp, profile }, testInfo) => {
         test.setTimeout(180_000);
         let app = await launchApp(profile, resolve("work/fixture.mp4"));
         let page = await app.firstWindow();
         await waitForVideo(page);
         await expect.poll(() => page.evaluate(async () => !!(await globalThis.desktop.bootstrap()).session)).toBe(true);
         await page.evaluate(async () => {
            const session = (await globalThis.desktop.bootstrap()).session;
            const clips = Array.from({ length: 500 }, (_, index) => ({
               id: `restoration-${index}`,
               color: index % 5,
               start: index === 0 ? 0 : 1 + (index - 1) / 30,
               end: index === 0 ? 1 : 1 + index / 30,
            }));
            await globalThis.desktop.saveSession({ ...session, clips, selectedId: clips[0].id, past: [], future: [] });
         });
         await page.reload();
         await waitForVideo(page);
         const measurements = [];
         for (let run = 0; run < 5; run++) {
            const start = (run + 1) / 10;
            // A restored session starts at zero, which is outside the trimmed first clip.
            // Move inside it before asking for its contextual editing fields.
            const bounds = await page.locator(".timeline-viewport").boundingBox();
            await page.mouse.click(bounds.x + bounds.width * (0.8 / 18), bounds.y + 36);
            await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 0.8) < 0.05);
            await page.getByRole("textbox", { name: "Clip start", exact: true }).fill(`00:00.${String(run + 1)}0`);
            await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
            await app.close();
            const began = performance.now();
            app = await launchApp(profile, "");
            page = await app.firstWindow();
            await waitForVideo(page);
            await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(500);
            await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", String(start));
            measurements.push({ run, readyMs: performance.now() - began });
         }
         await report(testInfo, "restoration-times", measurements);
      });
   });
}
