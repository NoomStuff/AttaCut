import assert from "node:assert/strict";
import { mkdir, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { indexedSampleTimes } from "../../src/main/media/mp4-index.ts";
import { indexedMkvKeyframes } from "../../src/main/media/mkv-index.ts";
import { packetsAround, probeSource, sourceKeyframes } from "../../src/main/media/probe.ts";
import { resolveFrameTime } from "../../src/shared/frames.ts";
import { ffmpegBase, runMedia } from "../../src/main/media/process.ts";
const files = (await readdir("work/formats"))
   .filter((name) => /\.(mp4|mov|mkv|webm|mk3d)$/.test(name) && !name.includes("-cut."))
   .map((name) => resolve("work/formats", name));
files.push(resolve("work/details/rotated.mov"));
if (process.env["ATTACUT_MEDIA_FILE"]) files.push(process.env["ATTACUT_MEDIA_FILE"]);
for (const path of files) {
   const source = await probeSource(path);
   const started = performance.now();
   const indexed: Awaited<ReturnType<typeof indexedSampleTimes>> | Awaited<ReturnType<typeof indexedMkvKeyframes>> = /\.(mp4|m4v|mov)$/.test(path)
      ? await indexedSampleTimes(source)
      : await indexedMkvKeyframes(source);
   const elapsed = performance.now() - started;
   const actual = await sourceKeyframes(source);
   const csv = await runMedia("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_packets",
      "-show_entries",
      "packet=pts_time,flags",
      "-of",
      "csv=p=0",
      path,
   ]);
   const expected = [
      ...new Set(
         csv
            .split(/\r?\n/)
            .filter((line) => line.includes("K"))
            .map((line) => Number(line.split(",")[0]) - source.startOffset)
            .filter((time) => time >= 0 && time <= source.duration)
      ),
   ].sort((a, b) => a - b);
   assert.equal(actual.length, expected.length, source.name);
   actual.forEach((time, i) => assert.ok(Math.abs(time - expected[i]!) < 0.00001, `${source.name}: ${time} != ${expected[i]}`));
   if (/\.(mkv|webm)$/.test(path) && !source.name.includes("fragmented")) assert.ok(indexed, `${source.name} should index from its Cues`);
   // Seek resolution from the MP4 frame index must agree with packet-window resolution.
   const frames = indexed && "frames" in indexed ? indexed.frames : null;
   if (frames) {
      for (const target of [0.5, 1, source.duration / 3, source.duration / 2, source.duration - 0.2].map((t) => Math.min(t, source.duration))) {
         const packets = await packetsAround(source, target);
         const windowTimes = packets.map((point) => point.time);
         const fromIndex = resolveFrameTime(frames, target, source.duration);
         const fromWindow = resolveFrameTime(windowTimes, target, source.duration);
         assert.ok(Math.abs(fromIndex - fromWindow) < 0.0001, `${source.name}: index resolve ${fromIndex} != window resolve ${fromWindow} @${target}`);
      }
   }
   console.log(
      `PASS ${source.name}: ${actual.length} keyframes, ${indexed ? elapsed.toFixed(1) + "ms index" : "packet fallback"}${frames ? `, ${frames.length} frames` : ""}`
   );
}

// FFprobe can start a requested interval at a keyframe far before the requested time.
// A short fixed read then misses the target, and a cached window repeats the wrong seek.
await mkdir("work/keyframes", { recursive: true });
const longGopPath = resolve(join("work/keyframes", "long-gop.mkv"));
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-f",
   "lavfi",
   "-i",
   "testsrc2=size=160x90:rate=1:duration=65",
   "-c:v",
   "libx264",
   "-preset",
   "ultrafast",
   "-g",
   "30",
   "-keyint_min",
   "30",
   "-sc_threshold",
   "0",
   "-an",
   longGopPath,
]);
const longGop = await probeSource(longGopPath);
for (const target of [13, 23, 49]) {
   const packets = await packetsAround(longGop, target, undefined, "seek");
   const times = packets.map((packet) => packet.time);
   assert.equal(resolveFrameTime(times, target, longGop.duration), target, `long-GOP seek at ${target}s`);
   assert.equal(resolveFrameTime(times, target, longGop.duration, 1), target + 1, `long-GOP frame step at ${target}s`);
}
console.log("PASS long-GOP MKV: cold and cached seeks include the requested frame and its successor");
