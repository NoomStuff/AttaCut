import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { probeSource } from "../../src/main/media/probe";
import { detectSceneCuts } from "../../src/main/media/scenes";
import { ffmpegBase, runMedia } from "../../src/main/media/process";

await mkdir("work/scenes", { recursive: true });
for (const offset of [0, 7, 36007]) {
   const path = resolve(`work/scenes/hard-cuts-${offset}.mkv`);
   // Known cuts at 1s and 2s, plus a short outro at 2.8s. Never snap to keyframes.
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-f",
      "lavfi",
      "-i",
      "color=black:s=160x90:r=25:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=white:s=160x90:r=25:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=black:s=160x90:r=25:d=0.8",
      "-f",
      "lavfi",
      "-i",
      "color=white:s=160x90:r=25:d=0.2",
      "-filter_complex",
      "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-g",
      "250",
      "-sc_threshold",
      "0",
      "-output_ts_offset",
      `${offset}`,
      path,
   ]);
   const source = await probeSource(path);
   const cuts = await detectSceneCuts(source, 10, new AbortController().signal);
   assert.equal(cuts.length, 3, JSON.stringify({ offset, cuts }));
   cuts.forEach((cut, i) => assert.ok(Math.abs(cut - [1, 2, 2.8][i]!) < 0.00001, `offset ${offset}: ${cut}`));
   console.log(`PASS scene detection: exact hard cuts and short outro with ${offset}s timestamp offset`);
}
const continuous = resolve("work/scenes/continuous.mkv");
await runMedia("ffmpeg", [...ffmpegBase, "-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=3", "-c:v", "libx264", continuous]);
assert.deepEqual(await detectSceneCuts(await probeSource(continuous), 10, new AbortController().signal), []);
console.log("PASS scene detection: continuous motion has no splits");
const fade = resolve("work/scenes/fade.mkv");
await runMedia("ffmpeg", [...ffmpegBase, "-f", "lavfi", "-i", "color=white:s=160x90:r=25:d=3,fade=t=in:st=0:d=2", "-c:v", "libx264", fade]);
assert.deepEqual(await detectSceneCuts(await probeSource(fade), 10, new AbortController().signal), []);
console.log("PASS scene detection: gradual fade is not a hard cut");
const vfr = resolve("work/scenes/variable-rate.mkv");
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-i",
   resolve("work/scenes/hard-cuts-0.mkv"),
   "-vf",
   "select='not(eq(mod(n,3),1))'",
   "-fps_mode",
   "vfr",
   "-c:v",
   "libx264",
   vfr,
]);
const vfrCuts = await detectSceneCuts(await probeSource(vfr), 10, new AbortController().signal);
assert.equal(vfrCuts.length, 3);
vfrCuts.forEach((time, i) => assert.ok(Math.abs(time - [1.04, 2, 2.84][i]!) < 0.00001, `variable rate cut: ${time}`));
console.log("PASS scene detection: variable-rate cuts use the first frame of the new scene");
const controller = new AbortController();
controller.abort();
await assert.rejects(detectSceneCuts(await probeSource(continuous), 10, controller.signal));
console.log("PASS scene detection: cancellation");
