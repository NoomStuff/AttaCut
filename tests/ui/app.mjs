import { _electron as electron, expect, test as base } from "@playwright/test";
import { mkdir } from "node:fs/promises";

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
      await use(async (profile, file) => {
         const app = await electron.launch({
            args: process.env.ATTACUT_EXECUTABLE ? [] : ["."],
            ...(process.env.ATTACUT_EXECUTABLE ? { executablePath: process.env.ATTACUT_EXECUTABLE } : {}),
            env: { ...process.env, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: file },
         });
         apps.add(app);
         app.on("close", () => apps.delete(app));
         const page = await app.firstWindow();
         page.setDefaultTimeout(15000);
         page.on("pageerror", (error) => errors.push(error.message));
         // Chromium needs a shown window to produce screenshots and video frames.
         await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
         return app;
      });
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
