import { _electron as electron, expect, test as base } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Some shells run Electron as their Node runtime; the app itself must launch normally.
export const appEnv = { ...process.env };
delete appEnv.ELECTRON_RUN_AS_NODE;

export function mediaBinary(name) {
   const configured = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
   if (configured) return configured;
   const bundled = resolve("resources/media", process.platform === "win32" ? `${name}.exe` : name);
   return existsSync(bundled) ? bundled : name;
}

export async function configureIpc(app, channel, rule) {
   await app.evaluate((_electron, { channel, rule }) => globalThis.attacutTestIpc.configure(channel, rule), { channel, rule });
}

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

// A pending frame seek can leave video.currentTime at the previous target.
// Navigation commands read the app clock, so wait for both to reach the target.
export function waitForPlaybackTime(page, time) {
   return page.waitForFunction((target) => {
      const current = document.querySelector("video")?.currentTime;
      const text = document.querySelector(".timeline-time time")?.textContent;
      const displayed = text ? text.split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0) : NaN;
      return Math.abs(current - target) < 0.05 && Math.abs(displayed - target) < 0.05 && !document.querySelector("video")?.seeking;
   }, time);
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
            env: {
               ...appEnv,
               ATTACUT_TESTING: "1",
               ATTACUT_HIDDEN: process.env.ATTACUT_TEST_VISIBLE === "1" ? "0" : "1",
               ATTACUT_USER_DATA: profile,
               ATTACUT_OPEN_FILE: file,
            },
         });
         apps.add(app);
         app.process().stdout?.on("data", (data) => logs.push(String(data)));
         app.process().stderr?.on("data", (data) => logs.push(String(data)));
         app.on("close", () => apps.delete(app));
         const page = await app.firstWindow();
         // Animation assertions must not depend on the desktop accessibility setting.
         await page.emulateMedia({ reducedMotion: "no-preference" });
         page.setDefaultTimeout(15000);
         page.on("pageerror", (error) => errors.push(error.message));
         page.on("console", (message) => logs.push(`[renderer ${message.type()}] ${message.text()}\n`));
         // Playwright sends input directly to Chromium; OS foreground focus is unnecessary.
         if (process.env.ATTACUT_TEST_VISIBLE === "1") await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
         else if (process.platform === "win32" || process.platform === "darwin") {
            // Native hidden windows can stop compositing paused video frames even
            // with backgroundThrottling disabled. Keep a transparent, inactive
            // window rendering, without a taskbar entry or native mouse hit target.
            await app.evaluate(({ BrowserWindow }) => {
               const window = BrowserWindow.getAllWindows()[0];
               window.setOpacity(0);
               window.setIgnoreMouseEvents(true);
               window.setSkipTaskbar(true);
               window.showInactive();
            });
         }
         // A BrowserWindow also exists when its page fails to load. Main-process-only
         // checks must not pass against that empty window and hang while closing it.
         try {
            await page.locator(".app-shell").waitFor({ state: "attached", timeout: process.env.CI ? 60000 : 30000 });
         } catch (error) {
            await testInfo.attach("electron-startup.log", { body: logs.join(""), contentType: "text/plain" });
            app.process().kill();
            apps.delete(app);
            throw error;
         }
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
