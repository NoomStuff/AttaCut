/* global window, requestAnimationFrame */
import { _electron as electron, expect } from "@playwright/test";
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

   // Make two clips first: set start/end, then split at 9s
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   const end = page.getByRole("textbox", { name: "Clip end", exact: true });
   await start.fill("00:01.30");
   await start.press("Tab");
   await end.fill("00:14.70");
   await end.press("Tab");
   const viewport = await page.locator(".timeline-viewport").boundingBox();
   await page.mouse.click(viewport.x + viewport.width * 0.5, viewport.y + viewport.height / 2);
   await page.waitForTimeout(150);
   await page.keyboard.press("s");
   await page.waitForTimeout(120);

   // 1) DELETE availability across states
   const deleteState = async (label) => {
      const state = await page.evaluate(() => {
         const button = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Delete selected clip");
         return { disabled: button?.disabled };
      });
      console.log(`[delete ${label}] disabled=${state.disabled}`);
   };
   await deleteState("after split, pointer over titlebar");
   await page.mouse.move(viewport.x + viewport.width * 0.3, viewport.y + viewport.height / 2);
   await page.waitForTimeout(80);
   await deleteState("pointer over clip area");
   await page.mouse.move(viewport.x + viewport.width * 0.85, viewport.y + 8);
   await page.waitForTimeout(80);
   await deleteState("pointer over ruler (outside clip)");

   // 2) PREV/NEXT during handle drag
   const handle = page.getByRole("slider", { name: "Clip 2 start", exact: true });
   const hb = await handle.boundingBox();
   const prevNextState = () =>
      page.evaluate(() => {
         const get = (label) => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === label)?.disabled;
         return {
            prev: get("Previous clip"),
            next: get("Next clip"),
            split: [...document.querySelectorAll("button")].find((b) => b.textContent === "Split")?.disabled,
         };
      });
   console.log("[prev/next idle]", JSON.stringify(await prevNextState()));
   await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
   await page.mouse.down();
   await page.mouse.move(hb.x - 30, hb.y + hb.height / 2, { steps: 4 });
   await page.waitForTimeout(60);
   console.log("[prev/next mid-drag]", JSON.stringify(await prevNextState()));
   await page.mouse.move(hb.x - 120, hb.y + hb.height / 2, { steps: 4 });
   await page.waitForTimeout(60);
   console.log("[prev/next mid-drag 2]", JSON.stringify(await prevNextState()));
   await page.mouse.up();
   console.log("[prev/next after drag]", JSON.stringify(await prevNextState()));

   // 3) Handle drag smoothness: sample handle x per frame while dragging steadily
   const hb2 = await page.getByRole("slider", { name: "Clip 2 start", exact: true }).boundingBox();
   await page.evaluate(() => {
      window.__xs = [];
      const tick = () => {
         const handle = [...document.querySelectorAll(".trim-handle")].find((h) => h.getAttribute("aria-label") === "Clip 2 start");
         window.__xs.push(handle ? Math.round(handle.getBoundingClientRect().x * 10) / 10 : null);
         if (window.__xs.length < 90) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return "started";
   });
   await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
   await page.mouse.down();
   for (let i = 1; i <= 45; i++) {
      await page.mouse.move(hb2.x + 30 + i * 3, hb2.y + hb2.height / 2);
      await page.waitForTimeout(16);
   }
   await page.mouse.up();
   await page.waitForTimeout(400);
   const xs = await page.evaluate(() => window.__xs);
   const deltas = xs
      .slice(1)
      .map((v, i) => Math.round((v - xs[i]) * 10) / 10)
      .filter((_, i) => i % 2 === 0);
   console.log("[handle drag] per-frame deltas:", deltas.join(" "));

   // Delete follows the playhead, and split requires room on both sides.
   await page.mouse.click(viewport.x + viewport.width * 0.02, viewport.y + 8);
   await expect(page.getByRole("button", { name: "Delete selected clip", exact: true })).toBeDisabled();
   await page
      .locator(".clip-range")
      .nth(1)
      .click({ position: { x: 40, y: 10 } });
   await expect(page.getByRole("button", { name: "Delete selected clip", exact: true })).toBeEnabled();
   // 4) Focus after pointer interactions + shortcuts
   await page.locator(String.raw`[data-command="split"]`).click();
   await page.keyboard.press("s"); // unrelated shortcut? split actually
   const focusInfo = await page.evaluate(() => {
      const active = document.activeElement;
      const matches = [...document.querySelectorAll(":focus-visible")].map((el) => el.getAttribute("aria-label") || el.textContent || el.tagName);
      return { active: active?.getAttribute("aria-label") || active?.textContent || active?.tagName, focusVisible: matches };
   });
   console.log("[focus after click split + press s]", JSON.stringify(focusInfo));
   await page.keyboard.press("i"); // set start shortcut
   const focusInfo2 = await page.evaluate(() =>
      [...document.querySelectorAll(":focus-visible")].map((el) => el.getAttribute("aria-label") || el.textContent || el.tagName)
   );
   console.log("[focus-visible after shortcut i]", JSON.stringify(focusInfo2));
} finally {
   await application.close();
}
