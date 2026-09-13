/* global KeyboardEvent, performance, requestAnimationFrame, getComputedStyle, window, URL */
/* Regression checks for interaction feel: play-button shortcut feedback, preview starting at
   the clip start, keyframe snapping within the length floor, and undo animating clip bounds. */
import assert from "node:assert/strict";
import { _electron as electron } from "@playwright/test";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
const profile = await mkdtemp(resolve("work/regressions-"));
const app = await electron.launch({
   args: ["."],
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
try {
   const page = await app.firstWindow();
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   await page.getByRole("slider", { name: "Clip 1 start", exact: true }).waitFor();
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   const view = await page.locator(".timeline-viewport").boundingBox();

   // Play via the keyboard: the button keeps its shortcut-flash class and animates its icon.
   await page.mouse.move(10, 10);
   await page.waitForTimeout(250);
   await page.keyboard.press("Space");
   await page.waitForTimeout(60);
   const flash = await page.evaluate(() => {
      const button = document.querySelector("[data-command=play]");
      const svg = button.querySelector("svg");
      return {
         shortcutActive: button.classList.contains("shortcut-active"),
         animation: getComputedStyle(svg).animationName,
         playing: !document.querySelector("video").paused,
      };
   });
   assert.equal(flash.shortcutActive, true, "Space should flash the play button");
   assert.match(flash.animation, /icon-(play|pause)/, "the play icon should animate on the keybind");
   assert.equal(flash.playing, true);
   await page.keyboard.press("Space");
   await page.waitForTimeout(200);

   // Hovering the button runs the same icon animation; sample frames to confirm it progresses.
   await page.mouse.move(10, 10);
   await page.waitForTimeout(300);
   const playButton = await page.locator("[data-command=play]").boundingBox();
   await page.mouse.move(playButton.x + playButton.width / 2, playButton.y + playButton.height / 2);
   const hover = await page.evaluate(async () => {
      const svg = document.querySelector("[data-command=play] svg");
      const frames = new Set();
      const started = performance.now();
      while (performance.now() - started < 280) {
         frames.add(getComputedStyle(svg).transform);
         await new Promise((done) => requestAnimationFrame(done));
      }
      return frames.size;
   });
   assert.ok(hover > 1, `hover should animate the play icon (${hover} distinct frames)`);

   // Preview from far away: the drawn playhead must sit on the video position immediately.
   await page.mouse.click(view.x + view.width * (12 / 18), view.y + 36);
   await page.waitForTimeout(300);
   const preview = await page.evaluate(async () => {
      const video = document.querySelector("video");
      const viewport = document.querySelector(".timeline-viewport").getBoundingClientRect();
      const drawnTime = () => {
         const head = document.querySelector(".playhead");
         if (!head) return null;
         const rect = head.getBoundingClientRect();
         return ((rect.x + rect.width / 2 - viewport.x) / viewport.width) * 18;
      };
      let worst = 0;
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
      const started = performance.now();
      while (performance.now() - started < 700) {
         await new Promise((done) => requestAnimationFrame(done));
         // The first couple of frames still commit the seek; sustained lag is the regression.
         if (performance.now() - started < 120) continue;
         const drawn = drawnTime();
         if (drawn !== null && !video.paused) worst = Math.max(worst, Math.abs(drawn - video.currentTime));
      }
      video.pause();
      return worst;
   });
   assert.ok(preview < 0.25, `preview playhead must track the clip start (worst gap ${preview.toFixed(3)}s)`);
   await page.waitForTimeout(150);

   // Snapping: boundaries land on keyframes, and stay on the last keyframe inside the
   // minimum-length floor instead of being pushed onto an un-snapped value.
   await page.keyboard.press("c");
   await page.waitForTimeout(300);
   const dragStart = async (to) => {
      const handle = await page.getByRole("slider", { name: "Clip 1 start", exact: true }).boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(view.x + (view.width * to) / 18, view.y + 36, { steps: 10 });
      await page.waitForTimeout(100);
      await page.mouse.up();
      await page.waitForTimeout(250);
      return page.getByRole("slider", { name: "Clip 1 start", exact: true }).getAttribute("aria-valuenow");
   };
   assert.equal(await dragStart(5.1), "6", "start handle should snap to the nearest keyframe");
   assert.equal(await dragStart(17.7), "16", "start handle should keep the last keyframe inside the length floor");
   await page.keyboard.press("c");

   // Trimming animates the clip bounds, and undoing animates them back. Seek into the clip
   // interior first: a playhead parked exactly on the start correctly disables trim-left.
   await page.mouse.click(view.x + (view.width * 17) / 18, view.y + 36);
   await page.waitForTimeout(200);
   await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })));
   await page.waitForTimeout(60);
   const trimTransition = await page.evaluate(() => getComputedStyle(document.querySelector(".clip-range")).transitionProperty);
   await page.waitForTimeout(300);
   await page.keyboard.press("Control+z");
   await page.waitForTimeout(60);
   const undoTransition = await page.evaluate(() => getComputedStyle(document.querySelector(".clip-range")).transitionProperty);
   assert.equal(trimTransition, "left, width", "trimming should animate clip bounds");
   assert.equal(undoTransition, "left, width", "undo should animate clip bounds back");

   // Scrub audio: the main process exposes mono PCM for the selected track.
   const scrub = await page.evaluate(async () => {
      const sourceId = decodeURIComponent(new URL(document.querySelector("video").currentSrc).pathname.replace(/^\//, ""));
      const data = await window.desktop.scrubAudio(sourceId, 1); // fixture maps its first audio track at stream index 1
      return { sampleRate: data?.sampleRate, bytes: data?.pcm?.byteLength ?? 0 };
   });
   assert.equal(scrub.sampleRate, 22050, "scrub audio should decode at its extraction rate");
   assert.ok(scrub.bytes > 22050 * 2, `scrub PCM should cover the fixture (${scrub.bytes} bytes)`);
   console.log("Interaction regressions passed");
} finally {
   await app.close();
}
