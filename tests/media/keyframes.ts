import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { indexedKeyframes } from "../../src/main/media/mp4-index.ts";
import { probeSource, sourceKeyframes } from "../../src/main/media/probe.ts";
import { runMedia } from "../../src/main/media/process.ts";
const files = (await readdir("work/formats"))
   .filter((name) => /\.(mp4|mov)$/.test(name) && !name.includes("-cut."))
   .map((name) => resolve("work/formats", name));
files.push(resolve("work/details/rotated.mov"));
if (process.env["ATTACUT_MEDIA_FILE"]) files.push(process.env["ATTACUT_MEDIA_FILE"]);
for (const path of files) {
   const source = await probeSource(path);
   const started = performance.now();
   const indexed = await indexedKeyframes(source);
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
   const expected = csv
      .split(/\r?\n/)
      .filter((line) => line.includes("K"))
      .map((line) => Number(line.split(",")[0]) - source.startOffset)
      .filter((time) => time >= 0 && time <= source.duration)
      .sort((a, b) => a - b);
   assert.equal(actual.length, expected.length, source.name);
   actual.forEach((time, i) => assert.ok(Math.abs(time - expected[i]!) < 0.00001, `${source.name}: ${time} != ${expected[i]}`));
   console.log(`PASS ${source.name}: ${actual.length} keyframes, ${indexed ? elapsed.toFixed(1) + "ms index" : "packet fallback"}`);
}
