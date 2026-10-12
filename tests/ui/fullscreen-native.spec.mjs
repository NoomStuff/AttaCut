import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import sharp from "sharp";
import { test, waitForVideo, mediaBinary } from "./app.mjs";

const run = promisify(execFile);

// Chromium screenshots can miss stale DirectComposition visuals. PrintWindow
// captures the native composed window, even on a locked desktop. Opt into screen
// capture on an unlocked desktop to also check the final displayed pixels.
async function captureScreen(app, path) {
   const handle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
   const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class Capture { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags); public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }\'',
      "[Capture]::SetProcessDPIAware() | Out-Null",
      "Add-Type -AssemblyName System.Drawing",
      "$rect = New-Object Capture+RECT",
      `if (-not [Capture]::GetWindowRect([IntPtr]::new(${handle}), [ref]$rect)) { throw 'Window bounds unavailable' }`,
      "$bitmap = New-Object System.Drawing.Bitmap(($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))",
      "$graphics = [System.Drawing.Graphics]::FromImage($bitmap)",
      "try {",
      ...(process.env.ATTACUT_TEST_SCREEN_CAPTURE === "1"
         ? ["$graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)"]
         : [
              "$dc = $graphics.GetHdc()",
              `try { if (-not [Capture]::PrintWindow([IntPtr]::new(${handle}), $dc, 2)) { throw 'Window capture failed' } } finally { $graphics.ReleaseHdc($dc) }`,
           ]),
      `$bitmap.Save('${path.replaceAll("'", "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "} finally { $graphics.Dispose(); $bitmap.Dispose() }",
   ].join("\n");
   await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30000 });
}

test("native fullscreen portrait stays centered through paused controls and occlusion", async ({ launchApp, profile }, testInfo) => {
   test.skip(process.platform !== "win32" || process.env.ATTACUT_NATIVE_SMOKE !== "1", "Visible Windows native capture");
   const fixture = join(profile, "portrait.mp4");
   await run(
      mediaBinary("ffmpeg"),
      ["-v", "error", "-f", "lavfi", "-i", "color=c=gray:size=360x640:rate=30:duration=18", "-c:v", "libx264", "-pix_fmt", "yuv420p", fixture],
      { windowsHide: true }
   );
   const app = await launchApp(profile, fixture);
   const page = await app.firstWindow();
   await waitForVideo(page);
   await app.evaluate(({ BrowserWindow }, screenCapture) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setOpacity(screenCapture ? 1 : 0);
      window.setIgnoreMouseEvents(true);
      window.showInactive();
   }, process.env.ATTACUT_TEST_SCREEN_CAPTURE === "1");
   if (!(await page.locator("video").evaluate((video) => video.paused))) await page.getByRole("button", { name: "Pause", exact: true }).click();
   const time = await page.locator("video").evaluate((video) => video.currentTime);
   await page.locator(".player-stage").evaluate((stage) => {
      stage.style.animationPlayState = "paused";
   });
   await page.getByRole("button", { name: "Fullscreen video", exact: true }).click();
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(true);
   const probe = async (name) => {
      await app.evaluate(({ BrowserWindow }) => {
         const window = BrowserWindow.getAllWindows()[0];
         window.moveTop();
      });
      const path = testInfo.outputPath(`${name}.png`);
      await captureScreen(app, path);
      await testInfo.attach(name, { path, contentType: "image/png" });
      const { data, info } = await sharp(path).grayscale().raw().toBuffer({ resolveWithObject: true });
      const content = await app.evaluate(({ BrowserWindow }) => {
         const window = BrowserWindow.getAllWindows()[0];
         return { bounds: window.getBounds(), content: window.getContentBounds() };
      });
      const fit = await page.locator("video").evaluate((video) => {
         const rect = video.getBoundingClientRect();
         const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
         return { width: video.videoWidth * scale, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 };
      });
      const pixelRatio = info.width / content.bounds.width;
      const centerX = (fit.centerX + content.content.x - content.bounds.x) * pixelRatio;
      const y = Math.floor((fit.centerY + content.content.y - content.bounds.y) * pixelRatio);
      const columns = Array.from({ length: info.width }, (_, x) => x).filter((x) => data[y * info.width + x] > 60);
      const expectedWidth = Math.round(fit.width * pixelRatio);
      expect(columns.length, `${name}: portrait width`).toBeCloseTo(expectedWidth, -1);
      expect((columns[0] + columns.at(-1)) / 2, `${name}: portrait center`).toBeCloseTo(centerX, -1);
      expect(await page.locator("video").evaluate((video) => video.currentTime)).toBe(time);
   };
   // Freeze entry partway through its scale to inspect the native presented frame.
   // Pausing a CSS animation does not seek or restart the paused video.
   await page.locator(".player-stage").evaluate((stage) => {
      const animation = stage.getAnimations().find((animation) => animation.animationName === "fullscreen-in");
      if (!animation) throw new Error("Fullscreen entry animation missing");
      animation.pause();
      animation.currentTime = 50;
   });
   await probe("entering");
   await page.locator(".player-stage").evaluate(async (stage) => {
      const animation = stage.getAnimations().find((animation) => animation.animationName === "fullscreen-in");
      animation.finish();
      await animation.finished;
      stage.style.animationPlayState = "";
   });
   await probe("entered");
   // Exercise compositor transitions while the decoded frame stays paused, including
   // the second hide/show cycle that reproduced the original sliver.
   for (let cycle = 0; cycle < 2; cycle++) {
      await page.locator(".fullscreen-controls").evaluate(async (controls) => {
         controls.classList.add("hidden");
         await Promise.all(controls.getAnimations().map((animation) => animation.finished));
      });
      await probe(`hidden-${cycle}`);
      await page.locator(".fullscreen-controls").evaluate(async (controls) => {
         controls.classList.remove("hidden");
         await Promise.all(controls.getAnimations().map((animation) => animation.finished));
      });
      await probe(`shown-${cycle}`);
   }
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true);
   await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false);
   await probe("restored");
   await page.locator(".player-stage").evaluate((stage) => {
      stage.style.animationPlayState = "paused";
      document.querySelector('button[aria-label="Exit fullscreen"]').click();
   });
   await expect(page.locator(".player-stage")).toHaveClass(/fullscreen-returning/);
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
   await page.locator(".player-stage").evaluate((stage) => {
      const animation = stage.getAnimations().find((animation) => animation.animationName === "fullscreen-return");
      animation.currentTime = 100;
   });
   await probe("returning");
   expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
   await page.locator(".player-stage").evaluate(async (stage) => {
      const animation = stage.getAnimations().find((animation) => animation.animationName === "fullscreen-return");
      animation.finish();
      await animation.finished;
      stage.style.animationPlayState = "";
   });
   await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false);
   const overlay = await app.evaluate(async ({ app }) => (await app.getGPUInfo("complete")).auxAttributes.overlayInfo);
   expect(overlay.supportsOverlays).toBe(false);
});
