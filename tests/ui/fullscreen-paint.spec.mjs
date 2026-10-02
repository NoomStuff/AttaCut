import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { _electron as electron, expect } from "@playwright/test";
import sharp from "sharp";
import { appEnv, mediaBinary, test, waitForVideo } from "./app.mjs";
import { resolve } from "node:path";

// Windows-only: the corruption lives in Chromium's Direct Composition video presentation,
// and the ground-truth capture uses GDI. CI (Linux) never sees the bug.
test.skip(process.platform !== "win32", "Direct Composition presentation is Windows-only");

const run = promisify(execFile);
const fixture = resolve("work/portrait.mp4");

async function ensureFixture() {
   if (existsSync(fixture)) return;
   await run(
      mediaBinary("ffmpeg"),
      [
         "-hide_banner",
         "-loglevel",
         "error",
         "-y",
         "-f",
         "lavfi",
         "-i",
         "testsrc2=size=1080x1920:rate=30",
         "-f",
         "lavfi",
         "-i",
         "sine=frequency=440",
         "-t",
         "8",
         "-c:v",
         "libx264",
         "-preset",
         "veryfast",
         "-pix_fmt",
         "yuv420p",
         "-c:a",
         "aac",
         fixture,
      ],
      { timeout: 120_000 }
   );
}

const hwndOf = (app) =>
   app.evaluate(({ BrowserWindow }) => {
      const bytes = BrowserWindow.getAllWindows()[0].getNativeWindowHandle();
      return BigInt("0x" + Buffer.from(bytes).toString("hex").match(/../g).reverse().join("")).toString();
   });

async function captureWindow(hwnd, file) {
   const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class Cap { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags); public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }\'',
      "[Cap]::SetProcessDPIAware() | Out-Null",
      "Add-Type -AssemblyName System.Drawing",
      `$h = [IntPtr]::new(${hwnd})`,
      "if ($h -eq [IntPtr]::Zero) { throw 'no window' }",
      "$r = New-Object Cap+RECT",
      "[Cap]::GetWindowRect($h, [ref]$r) | Out-Null",
      "$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top",
      "$bmp = New-Object System.Drawing.Bitmap($w, $ht)",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$dc = $g.GetHdc()",
      "[Cap]::PrintWindow($h, $dc, 2) | Out-Null",
      "$g.ReleaseHdc($dc)",
      `$bmp.Save('${file.replaceAll("\\", "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "$g.Dispose(); $bmp.Dispose()",
      'Write-Output "$w x $ht"',
   ].join("; ");
   const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 30000 });
   return stdout.trim();
}

// Ground truth: copy the actual screen region under the window rect.
async function captureScreenRect(hwnd, file) {
   const script = [
      'Add-Type -TypeDefinition \'using System; using System.Runtime.InteropServices; public class Cap2 { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); public struct RECT { public int Left; public int Top; public int Right; public int Bottom; } }\'',
      "[Cap2]::SetProcessDPIAware() | Out-Null",
      "Add-Type -AssemblyName System.Drawing",
      `$h = [IntPtr]::new(${hwnd})`,
      "$r = New-Object Cap2+RECT",
      "[Cap2]::GetWindowRect($h, [ref]$r) | Out-Null",
      "$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top",
      "$bmp = New-Object System.Drawing.Bitmap($w, $ht)",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $ht)))",
      `$bmp.Save('${file.replaceAll("\\", "/")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      "$g.Dispose(); $bmp.Dispose()",
   ].join("; ");
   const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 30000 });
   return stdout.trim();
}

async function analyze(file) {
   const { data, info } = await sharp(file).grayscale().raw().toBuffer({ resolveWithObject: true });
   const band = Math.round(info.height * 0.1); // keep the fullscreen control bar out of the scan
   let left = Infinity;
   let right = -1;
   for (let x = 0; x < info.width; x++) {
      let bright = 0;
      for (let y = 0; y < info.height - band; y++) if (data[y * info.width + x] > 60) bright++;
      if (bright > 60) {
         left = Math.min(left, x);
         right = Math.max(right, x);
      }
   }
   return { left, right, width: info.width, height: info.height };
}

async function probe(page, hwnd, app, name) {
   await page.waitForTimeout(400);
   // Keep the window above everything so the CopyFromScreen region is actually the app.
   await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setAlwaysOnTop(true, "screen-saver");
      win.moveTop();
      win.focus();
   });
   await page.waitForTimeout(250);
   const size = await captureWindow(hwnd, `work/fs-shots/${name}.png`);
   const paint = await analyze(`work/fs-shots/${name}.png`);
   const screenFile = `work/fs-shots/${name}-screen.png`;
   const screenSize = await captureScreenRect(hwnd, screenFile);
   const screenPaint = await analyze(screenFile);
   console.log(`  screen-truth: ${screenSize} paint ${screenPaint.left}..${screenPaint.right}`);
   const [w, h] = size.split(" x ").map(Number);
   const fitWidth = Math.round(h * (1080 / 1920));
   const expectedLeft = Math.round((w - fitWidth) / 2);
   const layout = await page.evaluate(() => {
      const video = document.querySelector("video").getBoundingClientRect();
      return { x: Math.round(video.x), w: Math.round(video.width) };
   });
   const verdict = paint.right < 0 ? "no video content visible" : Math.abs(paint.left - expectedLeft) < w * 0.02 ? "centered" : "MISALIGNED";
   console.log(
      `${name}: window ${w}x${h} | expected left ${expectedLeft} span ~${fitWidth}px | paint ${paint.left}..${paint.right} | layout ${layout.x}+${layout.w} | ${verdict}`
   );
   return verdict;
}

// eslint-disable-next-line no-empty-pattern
test("fullscreen video paints correctly when the controls hide", async ({}, testInfo) => {
   await ensureFixture();
   const profile = testInfo.outputPath("profile");
   await mkdir(profile, { recursive: true });
   const app = await electron.launch({
      args: ["."],
      env: {
         ...appEnv,
         ATTACUT_TESTING: "1",
         ATTACUT_TEST_VISIBLE: "1",
         ATTACUT_HIDDEN: "0",
         ATTACUT_USER_DATA: profile,
         ATTACUT_OPEN_FILE: fixture,
      },
   });
   try {
      const page = await app.firstWindow();
      const hwnd = await hwndOf(app);
      await waitForVideo(page);
      await page.locator("video").evaluate((video) => {
         video.currentTime = 0.2;
      });
      await page.waitForTimeout(400);

      await mkdir("work/fs-shots", { recursive: true });
      await page.locator(".player-stage").dblclick();
      await page.locator(".player-stage.fullscreen").waitFor({ state: "visible", timeout: 5000 });
      await page.waitForTimeout(500);
      const entered = await probe(page, hwnd, app, "1-entered-controls-visible");

      await page.waitForTimeout(3500); // the controls auto-hide at 2600 ms
      const hidden = await probe(page, hwnd, app, "2-controls-hidden");

      await page.mouse.move(960, 400);
      await page.waitForTimeout(600);
      const revived = await probe(page, hwnd, app, "3-controls-revived");

      // Every controls transition re-evaluates the video's presentation, so cycle again:
      // the corruption reliably landed on the second hide before the repaint fix.
      await page.waitForTimeout(3200);
      // Measure the visible window: capture at increasing delays after the transition.
      for (const delay of [0, 60, 120, 200, 320]) {
         await page.waitForTimeout(delay === 0 ? 0 : delay - [0, 60, 120, 200, 320][[0, 60, 120, 200, 320].indexOf(delay) - 1]);
         await captureWindow(hwnd, `work/fs-shots/heal-${delay}.png`);
         const healPaint = await analyze(`work/fs-shots/heal-${delay}.png`);
         console.log(`heal-window +${delay}ms: paint ${healPaint.left}..${healPaint.right}`);
      }
      const hiddenAgain = await probe(page, hwnd, app, "4-controls-hidden-again");
      await page.mouse.move(500, 400);
      await page.waitForTimeout(600);
      const revivedAgain = await probe(page, hwnd, app, "5-controls-revived-again");

      expect(entered, "video must be aligned right after entering fullscreen").toBe("centered");
      expect(hidden, "video must stay aligned once the controls fade").toBe("centered");
      expect(revived, "video must be aligned with controls back").toBe("centered");
      expect(hiddenAgain, "video must stay aligned after another fade").toBe("centered");
      expect(revivedAgain, "video must stay aligned after another revive").toBe("centered");
   } finally {
      await app.close();
   }
});
