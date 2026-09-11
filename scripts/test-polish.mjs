/* global getComputedStyle, requestAnimationFrame, HTMLInputElement, Event */
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
const profile = await mkdtemp(resolve("work/polish-profile-"));
const app = await electron.launch({
   args: ["."],
   env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: resolve("work/fixture.mp4") },
});
try {
   const page = await app.firstWindow();
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
   await page.getByRole("slider", { name: "Clip 1 start", exact: true }).waitFor();
   await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
   const slider = page.getByRole("slider", { name: "Preview volume", exact: true });
   const range = await slider.boundingBox();
   const volume = Number(await slider.inputValue());
   await page.mouse.move(range.x + 5 + (range.width - 10) * volume, range.y + range.height / 2);
   await page.mouse.down();
   await page.mouse.move(range.x, range.y + range.height / 2, { steps: 12 });
   await page.mouse.up();
   await expect(page.getByRole("button", { name: "Unmute preview", exact: true })).toBeVisible();
   assert(await page.locator("video").evaluate((v) => v.muted));
   await page.getByRole("button", { name: "Unmute preview", exact: true }).click();
   await expect(slider).toHaveValue(String(volume));
   assert.equal(await page.locator("video").evaluate((v) => v.volume), volume);
   assert.equal(await page.locator("video").evaluate((v) => v.muted), false);
   // Measure intermediate positions while the visual follows a large volume change.
   const volumeFrames = await page.evaluate(async () => {
      const input = document.querySelector(".volume-slider input");
      const initial = Number(input.value);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(input, 0.2);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const points = [];
      for (let i = 0; i < 10; i++) {
         await new Promise(requestAnimationFrame);
         points.push(Number(document.querySelector(".volume-slider").style.getPropertyValue("--volume")));
      }
      return { initial, points };
   });
   assert(volumeFrames.points.some((v) => v > 0.21 && v < volumeFrames.initial - 0.01));
   await page.getByRole("textbox", { name: "Clip start", exact: true }).fill("00:02.00");
   await page.getByRole("textbox", { name: "Clip start", exact: true }).press("Tab");
   const clip = await page.locator(".clip-range:not(.leaving)").boundingBox();
   await page.mouse.move(clip.x + clip.width * 0.2, clip.y + clip.height / 2);
   await expect(page.locator(".trim-handle.start.nearby")).toHaveCount(1);
   await page.waitForTimeout(160);
   assert.equal(await page.locator(".trim-handle.start").evaluate((el) => getComputedStyle(el).width), "12px");
   await page.mouse.move(clip.x + clip.width * 0.8, clip.y + clip.height / 2);
   await expect(page.locator(".trim-handle.end.nearby")).toHaveCount(1);
   await page.waitForTimeout(160);
   assert.equal(await page.locator(".trim-handle.start").evaluate((el) => getComputedStyle(el).width), "6px");
   // The handle also accepts a press slightly outside its visible edge.
   const start = await page.locator(".trim-handle.start").boundingBox();
   await page.mouse.move(start.x - 2, start.y + start.height / 2);
   await page.mouse.down();
   await page.mouse.move(start.x + 25, start.y + start.height / 2, { steps: 4 });
   await page.keyboard.press("Escape");
   await page.mouse.up();
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "2");
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(viewport.x + viewport.width * 0.5, viewport.y + 8);
   await page.keyboard.press("s");
   await expect(page.locator(".clip-range.flash")).toHaveCount(2);
   await expect(page.locator(".clip-range.entering")).toHaveCount(0);
   await page.waitForTimeout(750);
   await expect(page.locator(".clip-range.entering")).toHaveCount(0);
   await page.keyboard.press("Control+z");
   await expect(page.locator(".clip-range.flash")).toHaveCount(1);
   await expect(page.locator(".merging-seam")).toHaveCount(1);
   await expect(page.locator(".merging-seam")).toHaveCount(0);
   await expect(page.locator(".clip-range.leaving")).toHaveCount(0);
   await page.keyboard.press("Control+Shift+z");
   await expect(page.locator(".clip-range.flash")).toHaveCount(2);
   await page.waitForTimeout(750);
   // Delete and add are immediate edits with brief visual exit/entry feedback.
   await page.keyboard.press("ArrowLeft");
   await expect(page.locator(".selected-clip-label")).toContainText("Clip 1");
   await expect(page.getByRole("button", { name: "Delete selected clip", exact: true })).toBeEnabled();
   await page.keyboard.press("ArrowRight");
   await page.keyboard.press("ArrowRight");
   await expect(page.locator(".selected-clip-label")).toContainText("Clip 2");
   await expect(page.getByRole("button", { name: "Delete selected clip", exact: true })).toBeEnabled();
   await page.getByRole("button", { name: "Delete selected clip", exact: true }).click();
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveCount(0);
   await page.waitForTimeout(170);
   await expect(page.locator(".clip-range.leaving")).toHaveCount(0);
   await page.mouse.click(viewport.x + viewport.width * 0.8, viewport.y + 8);
   await page.getByRole("button", { name: "Add clip in gap", exact: true }).click();
   await expect(page.getByRole("slider", { name: "Clip 2 start", exact: true })).toHaveCount(1);
   await page.waitForTimeout(200);
   await expect(page.locator(".clip-range.entering")).toHaveCount(0);
   // Hover release must not resurrect the previous icon-swap animation.
   await page.getByRole("button", { name: "Play", exact: true }).hover();
   await page.waitForTimeout(350);
   await page.mouse.move(20, 20);
   assert.equal(await page.locator(".play-button svg").evaluate((el) => getComputedStyle(el).animationName), "none");
   await page.getByRole("button", { name: "Export", exact: true }).click();
   const separate = page.getByRole("button", { name: "Separate clips", exact: true });
   await separate.click();
   await page.waitForTimeout(220);
   const before = await page.locator(".export-mode").evaluate((el) => getComputedStyle(el, "::before").transform);
   await page.getByRole("button", { name: "Merged Video", exact: true }).click();
   await page.waitForTimeout(70);
   const during = await page.locator(".export-mode").evaluate((el) => getComputedStyle(el, "::before").transform);
   await page.waitForTimeout(160);
   const after = await page.locator(".export-mode").evaluate((el) => getComputedStyle(el, "::before").transform);
   assert.notEqual(during, before);
   assert.notEqual(during, after);
   await page.screenshot({ path: "work/screenshots/export-polish.png" });
   await page.getByRole("button", { name: "Close panel", exact: true }).click();
   await page.waitForTimeout(160);
   await page.screenshot({ path: "work/screenshots/editor-polish.png" });
   for (const width of [1100, 1000, 960, 900, 850, 800]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 700), width);
      await page.waitForTimeout(100);
      const layout = await page.locator(".transport").evaluate((el) => {
         const groups = [...el.children].map((child) => child.getBoundingClientRect());
         return {
            widths: groups.map((b) => [b.left, b.width]),
            available: el.clientWidth,
            overlap: groups.some((box, i) => i > 0 && box.left < groups[i - 1].right - 1),
            overflow: groups.at(-1).right > el.getBoundingClientRect().right + 1,
         };
      });
      console.log(width, layout);
      assert(!layout.overlap && !layout.overflow, `Transport overlaps or overflows at ${width}px`);
   }
   console.log(
      "Polish passed: volume smoothing and unmute restore, nearby handles and hit slop, split/merge undo feedback, add/delete cleanup, play hover release, sliding export selector."
   );
} finally {
   await app.close();
}
