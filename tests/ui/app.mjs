import { _electron as electron, expect, test as base } from "@playwright/test";
import { mkdir } from "node:fs/promises";

// Some shells run Electron as their Node runtime; the app itself must launch normally.
export const appEnv = { ...process.env };
delete appEnv.ELECTRON_RUN_AS_NODE;

export async function waitForVideo(page) {
   try {
      // Cold CI runners may need to initialize software decoding and prepare audio.
      // Keep ordinary interaction timeouts short; only media startup gets this budget.
      await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, undefined, { timeout: process.env.CI ? 60000 : 30000 });
   } catch (error) {
      const state = await page
         .evaluate(() => {
            const video = document.querySelector("video");
            return {
               text: document.body.innerText,
               video: video && { src: video.currentSrc, readyState: video.readyState, networkState: video.networkState, error: video.error?.message },
            };
         })
         .catch(() => "Renderer unavailable");
      throw new Error(`Video did not become ready: ${JSON.stringify(state)}`, { cause: error });
   }
}

export const test = base.extend({
   // eslint-disable-next-line no-empty-pattern
   profile: async ({}, use, testInfo) => {
      const profile = testInfo.outputPath("profile");
      await mkdir(profile, { recursive: true });
      await use(profile);
   },
   // Playwright requires destructuring even when the fixture has no dependencies.
   // eslint-disable-next-line no-empty-pattern
   launchApp: async ({}, use, testInfo) => {
      const apps = new Set();
      const errors = [];
      const logs = [];
      await use(async (profile, file) => {
         const app = await electron.launch({
            args: [...(process.env.ATTACUT_EXECUTABLE ? [] : ["."]), ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : [])],
            ...(process.env.ATTACUT_EXECUTABLE ? { executablePath: process.env.ATTACUT_EXECUTABLE } : {}),
            env: { ...appEnv, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: file },
         });
         apps.add(app);
         app.process().stdout?.on("data", (data) => logs.push(String(data)));
         app.process().stderr?.on("data", (data) => logs.push(String(data)));
         app.on("close", () => apps.delete(app));
         const page = await app.firstWindow();
         page.setDefaultTimeout(15000);
         page.on("pageerror", (error) => errors.push(error.message));
         page.on("console", (message) => logs.push(`[renderer ${message.type()}] ${message.text()}\n`));
         // Keyboard shortcuts need the same active window that a user would have.
         await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
         return app;
      });
      if (testInfo.status !== testInfo.expectedStatus || errors.length) {
         await testInfo.attach("electron.log", { body: logs.join(""), contentType: "text/plain" });
      }
      for (const app of apps) {
         try {
            if (testInfo.status !== testInfo.expectedStatus || errors.length) {
               const page = app.windows()[0];
               if (page) {
                  const path = testInfo.outputPath("failure.png");
                  await page.screenshot({ path, timeout: 5000 });
                  await testInfo.attach("failure", { path, contentType: "image/png" });
               }
            }
         } finally {
            await app.close();
         }
      }
      expect(errors, "Renderer errors").toEqual([]);
   },
});
