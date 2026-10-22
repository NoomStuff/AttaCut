import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { test, waitForVideo, mediaBinary } from "./app.mjs";

const run = promisify(execFile);

// Chromium screenshots can miss stale DirectComposition visuals. PrintWindow
// captures the native composed window, even on a locked desktop. Opt into screen
// capture on an unlocked desktop to also check the final displayed pixels.
async function captureScreen(app, path) {
   const handle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readBigUInt64LE().toString());
   const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class Capture { [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context); [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h); [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p); [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attribute, out RECT r, int size); public struct POINT { public int X; public int Y; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags); public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }\'',
      "[Capture]::SetThreadDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null",
      "Add-Type -AssemblyName System.Drawing",
      "$rect = New-Object Capture+RECT",
      `if (-not [Capture]::GetWindowRect([IntPtr]::new(${handle}), [ref]$rect)) { throw 'Window bounds unavailable' }`,
      "$client = New-Object Capture+RECT",
      "$origin = New-Object Capture+POINT",
      "$frame = New-Object Capture+RECT",
      `if (-not [Capture]::GetClientRect([IntPtr]::new(${handle}), [ref]$client)) { throw 'Client bounds unavailable' }`,
      `if (-not [Capture]::ClientToScreen([IntPtr]::new(${handle}), [ref]$origin)) { throw 'Client origin unavailable' }`,
      `if ([Capture]::DwmGetWindowAttribute([IntPtr]::new(${handle}), 9, [ref]$frame, 16) -ne 0) { throw 'DWM frame bounds unavailable' }`,
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
      `@{ window = $rect; client = @{ Left = $origin.X; Top = $origin.Y; Width = $client.Right; Height = $client.Bottom }; frame = $frame; dpi = [Capture]::GetDpiForWindow([IntPtr]::new(${handle})) } | ConvertTo-Json -Depth 4 -Compress`,
   ].join("\n");
   const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: 30000 });
   return JSON.parse(stdout);
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
      const native = await captureScreen(app, path);
      const geometryPath = testInfo.outputPath(`${name}-geometry.json`);
      await writeFile(geometryPath, JSON.stringify(native, null, 2));
      await testInfo.attach(`${name}-geometry`, { path: geometryPath, contentType: "application/json" });
      await testInfo.attach(name, { path, contentType: "image/png" });
      const { data, info } = await sharp(path).grayscale().raw().toBuffer({ resolveWithObject: true });
      const viewport = await page.evaluate(() => ({ width: globalThis.innerWidth, height: globalThis.innerHeight, pixelRatio: globalThis.devicePixelRatio }));
      const pixelRatio = native.dpi / 96;
      expect(pixelRatio).toBe(viewport.pixelRatio);
      expect(native.client.Width).toBe(Math.round(viewport.width * pixelRatio));
      expect(native.client.Height).toBe(Math.round(viewport.height * pixelRatio));
      expect(info.width).toBe(native.window.Right - native.window.Left);
      expect(info.height).toBe(native.window.Bottom - native.window.Top);
      expect(native.frame.Left).toBeGreaterThanOrEqual(native.window.Left);
      expect(native.frame.Right).toBeLessThanOrEqual(native.window.Right);
      const clientLeft = native.client.Left - native.window.Left;
      const clientTop = native.client.Top - native.window.Top;
      expect(clientLeft).toBeGreaterThanOrEqual(0);
      expect(clientTop).toBeGreaterThanOrEqual(0);
      expect(clientLeft + native.client.Width).toBeLessThanOrEqual(info.width);
      expect(clientTop + native.client.Height).toBeLessThanOrEqual(info.height);
      const fit = await page.locator("video").evaluate((video) => {
         const rect = video.getBoundingClientRect();
         const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
         return { width: video.videoWidth * scale, centerX: rect.x + rect.width / 2, centerY: rect.y + rect.height / 2 };
      });
      const centerX = clientLeft + fit.centerX * pixelRatio;
      const y = Math.floor(clientTop + fit.centerY * pixelRatio);
      // GetWindowRect includes invisible resize borders. Scan the entire native
      // client row, so stale or stretched video anywhere in the client still fails.
      const columns = Array.from({ length: native.client.Width }, (_, x) => clientLeft + x).filter((x) => data[y * info.width + x] > 60);
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
