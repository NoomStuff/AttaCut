/* global performance, requestAnimationFrame, WheelEvent */
import assert from "node:assert/strict";
import { _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";

const profile = await mkdtemp(resolve("work/repro-profile-"));
const application = await electron.launch({
   args: ["."],
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
try {
   const page = await application.firstWindow();
   await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   page.setDefaultTimeout(15000);
   await page.getByRole("slider", { name: "Clip 1 start", exact: true }).waitFor();
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   await page.waitForTimeout(300);

   const viewport = page.locator(".timeline-viewport");
   const box = await viewport.boundingBox();
   const y = box.y + box.height / 2;

   // --- Probe: sample playhead presence + position every frame for ms ---
   async function probe(ms) {
      return page.evaluate(
         ({ ms }) => {
            return new Promise((done) => {
               const samples = [];
               const start = performance.now();
               const tick = () => {
                  const playhead = document.querySelector(".playhead");
                  const viewport = document.querySelector(".timeline-viewport");
                  const clip = document.querySelector(".clip-range");
                  const view = viewport?.getBoundingClientRect();
                  const ph = playhead?.getBoundingClientRect();
                  samples.push({
                     t: Math.round(performance.now() - start),
                     ph: ph ? Math.round(((ph.x + ph.width / 2 - view.x) / view.width) * 1000) / 10 : null,
                     clip: clip ? Math.round(clip.getBoundingClientRect().x - view.x) : null,
                     clipW: clip ? Math.round(clip.getBoundingClientRect().width) : null,
                  });
                  if (performance.now() - start < ms) requestAnimationFrame(tick);
                  else done(samples);
               };
               requestAnimationFrame(tick);
            });
         },
         { ms }
      );
   }

   const report = (label, samples) => {
      const ph = samples.map((s) => s.ph);
      let backwards = 0;
      for (let i = 1; i < ph.length; i++) if (ph[i - 1] !== null && ph[i] !== null && ph[i] < ph[i - 1] - 0.05) backwards++;
      const off = samples.filter((s) => s.ph === null).length;
      assert.equal(backwards, 0);
      assert.equal(off, 0);
      console.log(`[${label}] samples=${samples.length} playheadMovesBackwards=${backwards} playheadGoneFrames=${off}`);
      console.log(`  ph: ${ph.filter((_, i) => i % 3 === 0).join(" ")}`);
   };

   // 1) Plain click-seek: press at 80% then release (pressScrub path, no promotion)
   await page.mouse.move(box.x + box.width * 0.8, y);
   await page.mouse.down();
   await page.mouse.up();
   await report("click-seek 80%", await probe(400, "click"));

   // 2) Scrub: down at 30%, drag right to 70% in small steps while sampling per-move
   const scrubSamples = [];
   await page.mouse.move(box.x + box.width * 0.3, y);
   await page.mouse.down();
   for (let i = 1; i <= 24; i++) {
      await page.mouse.move(box.x + box.width * 0.3 + (i * (box.width * 0.4)) / 24, y);
      await page.waitForTimeout(12);
      scrubSamples.push(
         await page.evaluate(() => {
            const playhead = document.querySelector(".playhead");
            const view = document.querySelector(".timeline-viewport").getBoundingClientRect();
            const ph = playhead?.getBoundingClientRect();
            return ph ? Math.round(((ph.x + ph.width / 2 - view.x) / view.width) * 1000) / 10 : null;
         })
      );
   }
   await page.mouse.up();
   console.log(`[drag-scrub right] per-move playhead%: ${scrubSamples.join(" ")}`);
   console.log(
      `  backwardsSteps=${scrubSamples.filter((v, i) => i > 0 && scrubSamples[i - 1] !== null && v !== null && v < scrubSamples[i - 1] - 0.05).length} gone=${scrubSamples.filter((v) => v === null).length}`
   );

   // 3) Click far left then immediately drag right (pressScrub promotion under a running tween)
   await page.mouse.move(box.x + box.width * 0.9, y);
   await page.mouse.down();
   await page.waitForTimeout(40);
   await page.mouse.move(box.x + box.width * 0.15, y);
   const promo = [];
   for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(14);
      promo.push(
         await page.evaluate(() => {
            const playhead = document.querySelector(".playhead");
            const view = document.querySelector(".timeline-viewport").getBoundingClientRect();
            const ph = playhead?.getBoundingClientRect();
            return ph ? Math.round(((ph.x + ph.width / 2 - view.x) / view.width) * 1000) / 10 : null;
         })
      );
   }
   await page.mouse.up();
   console.log(`[click right then scrub left] ${promo.join(" ")}`);

   // 4) Wheel zoom: sample clip geometry per frame — look for instant snap then animate
   await page.mouse.move(box.x + box.width * 0.5, y);
   const zoomSamples = await page.evaluate(() => {
      return new Promise((done) => {
         const samples = [];
         const start = performance.now();
         const tick = () => {
            const clip = document.querySelector(".clip-range");
            const ruler = [...document.querySelectorAll(".ruler-tick.major")].map((el) => Math.round(el.getBoundingClientRect().x));
            const chip = document.querySelector(".timeline-time time");
            samples.push({
               t: Math.round(performance.now() - start),
               x: clip ? Math.round(clip.getBoundingClientRect().x * 10) / 10 : null,
               w: clip ? Math.round(clip.getBoundingClientRect().width * 10) / 10 : null,
               firstRuler: ruler[0] ?? null,
               rulerCount: ruler.length,
               chip: chip?.textContent,
            });
            if (performance.now() - start < 260) requestAnimationFrame(tick);
            else done(samples);
         };
         requestAnimationFrame(tick);
         // fire 3 wheel notches right away, on the viewport itself so the listener receives them
         const target = document.querySelector(".timeline-viewport");
         const r = target.getBoundingClientRect();
         for (let i = 0; i < 3; i++)
            setTimeout(
               () =>
                  target.dispatchEvent(
                     new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: r.x + r.width * 0.5, clientY: r.y + r.height / 2 })
                  ),
               i * 30
            );
      });
   });
   console.log("[wheel zoom x3]");
   for (const s of zoomSamples.filter((_, i) => i % 2 === 0))
      console.log(`  t=${s.t} clipX=${s.x} clipW=${s.w} ruler0=${s.firstRuler} ticks=${s.rulerCount} chip=${s.chip}`);
} finally {
   await application.close();
}
