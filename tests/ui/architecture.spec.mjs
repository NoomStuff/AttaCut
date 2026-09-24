import { expect } from "@playwright/test";
import { appEnv, test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("a second process preserves active cache files and forwards file opens", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   // Instance forwarding needs an open source, not a decoded video frame.
   await expect(page.locator(".title-filename")).toContainText("fixture.mp4");
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(1);
   const previewFolder = resolve(profile, "previews");
   await mkdir(previewFolder, { recursive: true });
   const marker = resolve(previewFolder, "active-preview-marker");
   await writeFile(marker, "owned by the first process");
   const executable = await app.evaluate(({ app }) => app.getPath("exe"));
   const args = process.env.ATTACUT_EXECUTABLE ? [] : ["."];
   if (process.env.CI && process.platform === "linux") args.push("--no-sandbox");
   const options = { env: { ...appEnv, ATTACUT_HIDDEN: "1", ATTACUT_USER_DATA: profile, ATTACUT_OPEN_FILE: "" }, timeout: 20000, windowsHide: true };
   await promisify(execFile)(executable, args, options);
   expect(await readFile(marker, "utf8")).toBe("owned by the first process");
   await expect(page.locator(".title-filename")).toContainText("fixture.mp4");
   await promisify(execFile)(executable, [...args, resolve("work/fixture.mkv")], options);
   await expect(page.locator(".title-filename")).toContainText("fixture.mkv");
   expect(app.windows()).toHaveLength(1);
});

test("playback leaves the root idle and close flushes the final edit", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   let page = await app.firstWindow();
   await waitForVideo(page);
   await page.addInitScript(() => {
      let lastHooks;
      globalThis.rootRenders = 0;
      globalThis.commits = 0;
      globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
         supportsFiber: true,
         inject: () => 1,
         onCommitFiberRoot: (_id, root) => {
            globalThis.commits++;
            const hooks = root.current.child?.memoizedState;
            if (hooks !== lastHooks) {
               lastHooks = hooks;
               globalThis.rootRenders++;
            }
         },
         onCommitFiberUnmount: () => {},
      };
   });
   // Reload mounts React with the profiling hook installed before its bundle executes.
   await page.waitForTimeout(150);
   await page.evaluate(async () => {
      const { session } = await globalThis.desktop.bootstrap();
      const clips = Array.from({ length: 500 }, (_, index) => ({
         id: `stress-${index}`,
         color: index % 5,
         start: index === 0 ? 0 : 9 + ((index - 1) * 9) / 499,
         end: index === 0 ? 9 : 9 + (index * 9) / 499,
      }));
      await globalThis.desktop.saveSession({ ...session, clips, selectedId: clips[0].id, past: [], future: [] });
   });
   await page.reload();
   await waitForVideo(page);
   await expect(page.locator(".clip-range:not(.exiting)")).toHaveCount(500);
   await page.getByRole("button", { name: "Play", exact: true }).click();
   await page.waitForFunction(() => document.querySelector("video").currentTime > 0.3);
   const before = await page.evaluate(() => ({ roots: globalThis.rootRenders, commits: globalThis.commits }));
   await page.waitForFunction(() => document.querySelector("video").currentTime > 2.3);
   const after = await page.evaluate(() => ({ roots: globalThis.rootRenders, commits: globalThis.commits }));
   // Headless CI can throttle animation frames heavily. Playback progress is
   // checked above; this only needs commits to show React updated during it.
   expect(after.commits - before.commits).toBeGreaterThan(0);
   expect(after.roots - before.roots).toBeLessThanOrEqual(2);
   console.log(`Playback commits: ${after.commits - before.commits}; root renders: ${after.roots - before.roots}`);
   await page.getByRole("button", { name: "Pause", exact: true }).click();
   const start = page.getByRole("textbox", { name: "Clip start", exact: true });
   await start.fill("00:01.30");
   await start.press("Tab");
   // Close before the debounced effect writes; the close handshake must supply this edit.
   await app.close();
   const settings = JSON.parse(await readFile(resolve(profile, "settings.json"), "utf8"));
   expect(settings.session.clips[0].start).toBe(1.3);
   const restored = await launchApp(profile, "");
   page = await restored.firstWindow();
   await expect(page.getByRole("slider", { name: "Clip 1 start", exact: true })).toHaveAttribute("aria-valuenow", "1.3");
});
