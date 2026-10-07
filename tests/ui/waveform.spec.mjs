import { expect } from "@playwright/test";
import { configureIpc, mediaBinary, test, waitForVideo } from "./app.mjs";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hasWaveformPixels, waveformColorCount } from "./waveform-pixels.mjs";

async function preferences(profile, values) {
   await writeFile(join(profile, "settings.json"), JSON.stringify({ version: 1, preferences: { updateCheck: false, ...values }, session: null }));
}
async function painted(page) {
   await expect.poll(() => hasWaveformPixels(page)).toBe(true);
}
async function trackFixture(profile) {
   const path = join(profile, "tracks.mp4");
   execFileSync(
      mediaBinary("ffmpeg"),
      [
         "-v",
         "error",
         "-f",
         "lavfi",
         "-i",
         "testsrc2=size=480x360:rate=30:duration=8",
         "-f",
         "lavfi",
         "-i",
         "anullsrc=r=48000:cl=stereo:d=8",
         "-f",
         "lavfi",
         "-i",
         "sine=frequency=660:duration=8",
         "-f",
         "lavfi",
         "-i",
         "aevalsrc=if(between(t\\,2\\,5)\\,0.5*sin(2*PI*440*t)\\,0):s=48000:d=8",
         "-map",
         "0:v",
         "-map",
         "1:a",
         "-map",
         "2:a",
         "-map",
         "3:a",
         "-c:v",
         "libx264",
         "-preset",
         "ultrafast",
         "-pix_fmt",
         "yuv420p",
         "-c:a",
         "ac3",
         "-b:a",
         "128k",
         path,
      ],
      { windowsHide: true }
   );
   return path;
}

test("Play inside a kept clip does not wait for frame analysis", async ({ launchApp, profile }) => {
   test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development fault injection");
   await preferences(profile, { waveform: true, keptOnly: true });
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await painted(page);
   await configureIpc(app, "source:frame-time", { before: "blocked-analysis" });
   const before = await app.evaluate(() => globalThis.attacutTestIpc.count("source:frame-time"));
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 0.2);
   expect(await app.evaluate(() => globalThis.attacutTestIpc.count("source:frame-time"))).toBe(before);
   expect(await app.evaluate(() => globalThis.attacutTestIpc.waiting("blocked-analysis"))).toBe(false);
});

test("losing window focus releases waveform work after a missed pointer up", async ({ launchApp, profile }) => {
   test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development fault injection");
   await preferences(profile, { waveform: true });
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await configureIpc(app, "waveform:start", { before: "wave-start" });
   await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", file), resolve("work/fixture.mp4"));
   await waitForVideo(page);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("wave-start"))).toBe(true);
   // Keep the pointer on the section, away from controls that seek the video.
   await page.evaluate(() => document.querySelector(".timeline-section").dispatchEvent(new globalThis.PointerEvent("pointerdown", { bubbles: true })));
   await app.evaluate(() => globalThis.attacutTestIpc.release("wave-start"));
   // Reassert activity after registration, covering a decoder paused while the mouse
   // release happens outside this window. A later blur must unpause the job.
   await page.evaluate(() => {
      document.dispatchEvent(new globalThis.PointerEvent("pointerup", { bubbles: true }));
      document.querySelector(".timeline-section").dispatchEvent(new globalThis.PointerEvent("pointerdown", { bubbles: true }));
   });
   await page.waitForTimeout(1000);
   expect((await readdir(join(profile, "waveforms")).catch(() => [])).filter((name) => name.endsWith(".wave"))).toHaveLength(0);
   await page.evaluate(() => globalThis.dispatchEvent(new globalThis.Event("blur")));
   await painted(page);
   await expect.poll(async () => (await readdir(join(profile, "waveforms"))).filter((name) => name.endsWith(".wave")).length).toBe(1);
});

test("a paused buffering event cannot leave the waveform suspended", async ({ launchApp, profile }) => {
   test.skip(!!process.env.ATTACUT_EXECUTABLE, "Development fault injection");
   await preferences(profile, { waveform: true });
   const app = await launchApp(profile, "");
   const page = await app.firstWindow();
   await configureIpc(app, "waveform:start", { before: "wave-start" });
   await app.evaluate(({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].webContents.send("app:open-file", file), resolve("work/fixture.mp4"));
   await waitForVideo(page);
   await expect.poll(() => app.evaluate(() => globalThis.attacutTestIpc.waiting("wave-start"))).toBe(true);
   await app.evaluate(() => globalThis.attacutTestIpc.release("wave-start"));
   await page.evaluate(() => document.querySelector("video").dispatchEvent(new globalThis.Event("waiting")));
   await painted(page);
});

test("a paused waveform can be replaced, and old cancellation cannot stop its replacement", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const outcome = await page.evaluate(async () => {
      const sourceId = decodeURIComponent(new globalThis.URL(document.querySelector("video").currentSrc).pathname.slice(1));
      const first = globalThis.desktop.waveformStart({ sourceId, requestId: "old", streamIndices: [1] }).then(
         () => "finished",
         () => "cancelled"
      );
      await globalThis.desktop.waveformActivity("old", true);
      const replacement = globalThis.desktop.waveformStart({ sourceId, requestId: "replacement", streamIndices: [2] });
      await globalThis.desktop.cancelWaveform("old");
      return { first: await first, replacement: await replacement };
   });
   expect(outcome.first).toBe("cancelled");
   expect(outcome.replacement.buckets).toBeGreaterThan(17000);
   expect(await readdir(join(profile, "waveforms"))).toHaveLength(1);
});

test("scrub audio finishes while waveform extraction is suspended", async ({ launchApp, profile }) => {
   await preferences(profile, { waveform: false, audioScrub: false });
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const outcome = await page.evaluate(async () => {
      const sourceId = decodeURIComponent(new globalThis.URL(document.querySelector("video").currentSrc).pathname.slice(1));
      let finished = false;
      let suspend;
      const suspended = new Promise((resolve) => {
         suspend = resolve;
      });
      const unsubscribe = globalThis.desktop.onWaveformChunk((chunk) => {
         if (chunk.requestId !== "suspended") return;
         void globalThis.desktop.waveformActivity("suspended", true).then(suspend);
      });
      const pending = globalThis.desktop.waveformStart({ sourceId, requestId: "suspended", streamIndices: [1] }).then((result) => {
         finished = true;
         return result;
      });
      await suspended;
      unsubscribe();
      const pcm = await globalThis.desktop.scrubAudio(sourceId, [1], 10);
      const completeDuringScrub = finished;
      await globalThis.desktop.waveformActivity("suspended", false);
      return { bytes: pcm?.pcm.byteLength ?? 0, completeDuringScrub, result: await pending };
   });
   expect(outcome.bytes).toBeGreaterThan(0);
   expect(outcome.completeDuringScrub).toBe(false);
   expect(outcome.result.buckets).toBeGreaterThan(17000);
});

test("a settled region streams before the full scan and does not corrupt its persistent cache", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   const outcome = await page.evaluate(async () => {
      const sourceId = decodeURIComponent(new globalThis.URL(document.querySelector("video").currentSrc).pathname.slice(1));
      const chunks = [];
      const unsubscribe = globalThis.desktop.onWaveformChunk((chunk) => {
         if (chunk.requestId === "priority") chunks.push({ offset: chunk.offset, count: chunk.peaks.length / 3, priority: !!chunk.priority });
      });
      const pending = globalThis.desktop.waveformStart({ sourceId, requestId: "priority", streamIndices: [1] });
      await globalThis.desktop.waveformRegion("priority", 10, 12);
      const result = await pending;
      unsubscribe();
      return { chunks, result };
   });
   expect(outcome.chunks[0]).toMatchObject({ priority: true, offset: 10000 });
   expect(outcome.chunks.filter((chunk) => chunk.priority).reduce((sum, chunk) => sum + chunk.count, 0)).toBe(2000);
   let covered = 0;
   for (const chunk of outcome.chunks.filter((chunk) => !chunk.priority)) {
      expect(chunk.offset).toBe(covered);
      covered += chunk.count;
   }
   expect(covered).toBe(outcome.result.buckets);
   const caches = (await readdir(join(profile, "waveforms"))).filter((name) => name.endsWith(".wave"));
   expect(caches).toHaveLength(1);
   expect((await readFile(join(profile, "waveforms", caches[0]))).length).toBe(16 + covered * 3);
});

test("waveform is opt-in and stays inside bottom-aligned clips without changing timeline height", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await expect(page.locator(".clip-waveform")).toHaveCount(0);
   const height = await page.locator(".timeline-viewport").evaluate((node) => node.getBoundingClientRect().height);
   await page.keyboard.press("ControlOrMeta+,");
   await page.getByRole("tab", { name: "Editing", exact: true }).press("Enter");
   await expect(page.getByRole("tab", { name: "Editing", exact: true })).toHaveAttribute("aria-selected", "true");
   const toggle = page.getByRole("switch", { name: "Timeline waveform" });
   await expect(toggle).not.toBeChecked();
   await toggle.press("Space");
   await page.keyboard.press("Escape");
   await painted(page);
   expect(await page.locator(".timeline-viewport").evaluate((node) => node.getBoundingClientRect().height)).toBe(height);
   const placement = await page.locator(".clip-waveform").evaluate((canvas) => {
      const a = canvas.getBoundingClientRect(),
         b = canvas.parentElement.querySelector(".clip-range").getBoundingClientRect();
      return { bottom: a.bottom - b.bottom, height: a.height, clipHeight: b.height };
   });
   expect(Math.abs(placement.bottom)).toBeLessThanOrEqual(1);
   expect(placement.height).toBeLessThanOrEqual(placement.clipHeight);
   await page.keyboard.press("ControlOrMeta+,");
   await page.getByRole("tab", { name: "Editing", exact: true }).press("Enter");
   await expect(page.getByRole("tab", { name: "Editing", exact: true })).toHaveAttribute("aria-selected", "true");
   await toggle.press("Space");
   await page.keyboard.press("Escape");
   await expect(page.locator(".clip-waveform")).toHaveCount(0);
});

test("prepared preview maps a higher source track, persists peaks and reuses them after restart", async ({ launchApp, profile }) => {
   const path = await trackFixture(profile);
   await preferences(profile, { waveform: true, playbackAudio: { mode: "tracks", sourceTrackCount: 3, tracks: [{ position: 2, title: "", language: "" }] } });
   const app = await launchApp(profile, path);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await painted(page).catch(async (error) => {
      console.log(
         await page.evaluate(() => ({
            video: {
               src: document.querySelector("video").currentSrc,
               ready: document.querySelector("video").readyState,
               seeking: document.querySelector("video").seeking,
            },
            canvases: [...document.querySelectorAll(".clip-waveform")].map((c) => [c.width, c.height]),
         }))
      );
      console.log(
         await app.evaluate(() =>
            Object.fromEntries(
               ["waveform:start", "waveform:cancel", "waveform:activity", "preview:prepare"].map((key) => [
                  key,
                  [globalThis.attacutTestIpc.count(key), globalThis.attacutTestIpc.ready(key)],
               ])
            )
         )
      );
      throw error;
   });
   expect(await page.evaluate(() => document.querySelector("video").currentSrc)).not.toContain("tracks.mp4");
   await expect.poll(async () => (await readdir(join(profile, "waveforms")).catch(() => [])).filter((name) => name.endsWith(".wave")).length).toBe(1);
   const names = await readdir(join(profile, "waveforms"));
   const cache = await readFile(
      join(
         profile,
         "waveforms",
         names.find((name) => name.endsWith(".wave"))
      )
   );
   expect(cache.subarray(16 + 500 * 3, 16 + 1500 * 3).every((value) => value === 0)).toBe(true);
   expect(cache[16 + 3500 * 3 + 2]).toBeGreaterThan(100);
   await app.close();
   const reopened = await launchApp(profile, path);
   const next = await reopened.firstWindow();
   await waitForVideo(next);
   await painted(next);
   expect((await readdir(join(profile, "waveforms"))).filter((name) => name.endsWith(".wave"))).toHaveLength(1);
});

test("waveform paints through deep zoom and panning while editor input and playback remain responsive", async ({ launchApp, profile }, testInfo) => {
   await preferences(profile, { waveform: true });
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await painted(page);
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + 35);
   for (let step = 0; step < 10; step++) await page.mouse.wheel(0, -500);
   await page.waitForTimeout(800);
   await painted(page);
   expect(
      await page
         .locator(".clip-waveform")
         .first()
         .evaluate((canvas) => canvas.width)
   ).toBeLessThanOrEqual(Math.ceil(viewport.width * 3));
   await page.mouse.wheel(500, 0);
   await page.waitForTimeout(300);
   await painted(page);
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("00:01.00");
   await start.press("Tab");
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "1");
   await page.locator(".title-filename").click();
   await page.keyboard.press("ControlOrMeta+z");
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "0");
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 1.2);
   await page.getByRole("button", { name: "Pause", exact: true }).click();
   await page.screenshot({ path: testInfo.outputPath("waveform-zoom.png") });
});

test("the shared waveform canvas clears excluded time after a trim", async ({ launchApp, profile }) => {
   await preferences(profile, { waveform: true });
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await painted(page);
   await expect(page.locator(".clip-waveform")).toHaveCount(1);
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("00:09.00");
   await start.press("Tab");
   // The excluded track has two flat colors. Audio detail must disappear here,
   // while the kept half still contains the peaks and RMS core.
   await expect.poll(() => waveformColorCount(page, 0.1, 0.25)).toBeLessThanOrEqual(2);
   await expect.poll(() => waveformColorCount(page, 0.65, 0.8)).toBeGreaterThan(5);
});
