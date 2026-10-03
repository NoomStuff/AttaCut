import { expect } from "@playwright/test";
import { mediaBinary, test, waitForVideo } from "./app.mjs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

// The timeline waveform is parked behind a forced-off preference until its load-time
// behavior holds up on real recordings; these guards fail if it ever resurfaces.
test("the timeline waveform stays hidden on directly playable recordings", async ({ launchApp, profile }) => {
   const app = await launchApp(profile, resolve("work/fixture.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.waitForTimeout(1500);
   await expect(page.locator(".clip-waveform")).toHaveCount(0);
});

test("the timeline waveform stays hidden on recordings that need a preview", async ({ launchApp, profile }) => {
   execFileSync(
      mediaBinary("ffmpeg"),
      [
         "-v",
         "error",
         "-f",
         "lavfi",
         "-i",
         "testsrc2=size=480x360:rate=30:duration=10",
         "-f",
         "lavfi",
         "-i",
         "sine=frequency=440:duration=10",
         "-c:v",
         "libx264",
         "-preset",
         "ultrafast",
         "-pix_fmt",
         "yuv420p",
         "-c:a",
         "ac3",
         "-b:a",
         "128k",
         "-shortest",
         join(profile, "ac3.mp4"),
      ],
      { windowsHide: true }
   );
   const app = await launchApp(profile, join(profile, "ac3.mp4"));
   const page = await app.firstWindow();
   await waitForVideo(page);
   await page.waitForTimeout(1500);
   await expect(page.locator(".clip-waveform")).toHaveCount(0);
});
