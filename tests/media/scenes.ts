import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { probeSource } from "../../src/main/media/probe";
import { detectBlack, detectSceneCuts, detectSilence } from "../../src/main/media/scenes";
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

// MOV keeps the duration separate from the timestamp offset. Black at 0-0.52, 1.52-2.0 and a short 2.6-3.0 outro. Silence at 1.0-1.8 and from 2.4 to the end.
const near = (actual: { start: number; end: number }[], expected: [number, number][], tolerance: number, label: string) => {
   assert.equal(actual.length, expected.length, `${label}: ${JSON.stringify(actual)}`);
   actual.forEach((range, i) => {
      assert.ok(Math.abs(range.start - expected[i]![0]) < tolerance, `${label} start: ${JSON.stringify(actual)}`);
      assert.ok(Math.abs(range.end - expected[i]![1]) < tolerance, `${label} end: ${JSON.stringify(actual)}`);
   });
};
for (const offset of [0, 7, 36007]) {
   const path = resolve(`work/scenes/gaps-${offset}.mov`);
   const colors = [
      ["black", 0.52],
      ["white", 1],
      ["black", 0.48],
      ["white", 0.6],
      ["black", 0.4],
   ] as const;
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      ...colors.flatMap(([color, duration]) => ["-f", "lavfi", "-i", `color=${color}:s=160x90:r=25:d=${duration}`]),
      "-f",
      "lavfi",
      "-i",
      "aevalsrc='0.5*sin(440*2*PI*t)*not(between(t,1,1.8))*lt(t,2.4)':s=48000:d=3",
      "-filter_complex",
      `${colors.map((_, i) => `[${i}:v]`).join("")}concat=n=${colors.length}:v=1:a=0[v]`,
      "-map",
      "[v]",
      "-map",
      `${colors.length}:a`,
      "-c:v",
      "libx264",
      "-g",
      "250",
      "-c:a",
      "pcm_s16le",
      "-output_ts_offset",
      `${offset}`,
      path,
   ]);
   const source = await probeSource(path);
   const audio = source.streams.find((stream) => stream.type === "audio")!;
   const signal = new AbortController().signal;
   const black = await detectBlack(source, 0.1, signal);
   near(
      black,
      [
         [0, 0.52],
         [1.52, 2],
         [2.6, source.duration],
      ],
      0.00001,
      `black at offset ${offset}`
   );
   near(
      await detectBlack(source, 0.45, signal),
      [
         [0, 0.52],
         [1.52, 2],
      ],
      0.00001,
      `long black at offset ${offset}`
   );
   const silence = await detectSilence(source, audio.index, -40, 0.5, signal);
   // The filter prints six significant digits, so a 36007 s origin would lose precision without the shift to source time.
   near(
      silence,
      [
         [1, 1.8],
         [2.4, source.duration],
      ],
      0.002,
      `silence at offset ${offset}`
   );
   assert.deepEqual(await detectSilence(source, audio.index, -40, 1, signal), [], `long silence at offset ${offset}`);
   console.log(`PASS range detection: black and silent parts with ${offset}s timestamp offset`);
}
await assert.rejects(detectSilence(await probeSource(continuous), 0, -40, 0.5, new AbortController().signal), /no audio/);
await assert.rejects(detectBlack(await probeSource(resolve("work/scenes/gaps-0.mov")), 0.1, controller.signal));
await assert.rejects(detectSilence(await probeSource(resolve("work/scenes/gaps-0.mov")), 1, -40, 0.5, controller.signal));
console.log("PASS range detection: missing audio and cancellation");
