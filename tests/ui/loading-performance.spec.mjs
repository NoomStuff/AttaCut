import { expect } from "@playwright/test";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test, waitForVideo } from "./app.mjs";
import { inspectMedia, expectFrameMatches, expectCopiedFrameMatches, expectAudioMatches } from "./media-checks.mjs";

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

      test("measure the complete open, trim, and accurate export workflow", async ({ launchApp, profile }, testInfo) => {
         const source = resolve("work/fixture.mp4");
         const output = join(profile, "exports");
         await mkdir(output);
         const sourceHash = createHash("sha256")
            .update(await readFile(source))
            .digest("hex");
         const started = performance.now();
         const app = await launchApp(profile, source);
         const page = await app.firstWindow();
         await waitForVideo(page);
         const opened = performance.now();
         const start = page.getByRole("textbox", { name: "Clip start", exact: true });
         const end = page.getByRole("textbox", { name: "Clip end", exact: true });
         await start.fill("00:01.30");
         await start.press("Tab");
         await end.fill("00:08.70");
         await end.press("Tab");
         await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "1.3");
         await expect(page.getByRole("slider", { name: "Clip 1 end", exact: true })).toHaveAttribute("aria-valuenow", "8.7");
         await page.getByRole("button", { name: "Export", exact: true }).click();
         await page.getByRole("button", { name: "Single Video", exact: true }).click();
         await page.getByLabel("Save to", { exact: true }).fill(output);
         await page.getByRole("textbox", { name: "Combined filename", exact: true }).fill("workflow");
         await expect(page.getByRole("button", { name: "Audio tracks to export", exact: true })).toContainText("All audio tracks");
         const exporting = performance.now();
         await page.getByRole("button", { name: "Export video", exact: true }).click();
         await expect(page.locator(".notification-entry").first().getByRole("button", { name: "Open file", exact: true })).toBeVisible({ timeout: 60000 });
         const completed = performance.now();
         await report(testInfo, "workflow-times", {
            startupMs: opened - started,
            editingMs: exporting - opened,
            exportMs: completed - exporting,
            totalMs: completed - started,
         });
         const diagnostics = testInfo.outputPath("workflow-diagnostics.json");
         await app.evaluate(({ dialog }, filePath) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath });
         }, diagnostics);
         await page.evaluate(() => globalThis.desktop.exportDiagnostics());
         await report(testInfo, "workflow-diagnostics", JSON.parse(await readFile(diagnostics, "utf8")));
         const result = join(output, "workflow.mp4");
         const media = await inspectMedia(result);
         expect(Number(media.format.duration)).toBeCloseTo(7.4, 1);
         expect(media.streams.filter((stream) => stream.codec_type === "audio")).toHaveLength(2);
         await expectFrameMatches(source, 1.3, result, 0);
         await expectFrameMatches(source, 8.7 - 1 / 30, result, 7.4 - 1 / 30);
         await expectCopiedFrameMatches(source, 4, result, 2.7);
         for (const track of [0, 1]) await expectAudioMatches(source, 4, result, 2.7, track);
         expect(
            createHash("sha256")
               .update(await readFile(source))
               .digest("hex")
         ).toBe(sourceHash);
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
            const requests = await app.evaluate(() =>
               globalThis.attacutTestIpc
                  ? {
                       single: globalThis.attacutTestIpc.count("source:frame-time"),
                       batch: globalThis.attacutTestIpc.count("source:frame-times"),
                    }
                  : null
            );
            measurements.push({ run, readyMs: performance.now() - began, requests });
         }
         await report(testInfo, "restoration-times", measurements);
      });
   });
}
