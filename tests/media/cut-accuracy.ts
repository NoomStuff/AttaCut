import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdir, rm, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { probeSource } from "../../src/main/media/probe.ts";
import { analyzeCut, exportCut } from "../../src/main/media/cut.ts";
import { runMedia } from "../../src/main/media/process.ts";
import { frameHashes, ssimScore } from "./compare.ts";

const path = resolve(process.env["ATTACUT_MEDIA_FILE"] || "work/fixture.mp4");
const source = await probeSource(path);
const before = await stat(path);
const prefix = process.env["ATTACUT_MEDIA_FILE"] ? "obs" : "fixture";
await mkdir("work/media-test", { recursive: true });
const video = source.streams.find((stream) => stream.type === "video")!;
for (const [start, end] of [
   [1.3, 14.7],
   [2, 12],
   [1.3, 2.7],
   ...(source.duration < 20
      ? [
           [0, 14.7],
           [1.3, source.duration],
        ]
      : []),
]) {
   const analysis = await analyzeCut(source, { id: "test", start: start!, end: end!, color: 0 });
   console.log(`${prefix}: ${start}-${end}`, JSON.stringify(analysis.spans));
   assert.notEqual(analysis.method, "unsupported", analysis.message);
   const output = resolve(`work/media-test/${prefix}-${start}-${end}${source.extension}`);
   await rm(output, { force: true });
   const started = Date.now();
   await exportCut(source, analysis, output);
   const decoded: {
      format: { duration: string };
      streams: { codec_type: string; nb_read_frames: string; duration: string; start_time: string }[];
   } = JSON.parse(
      await runMedia("ffprobe", [
         "-v",
         "error",
         "-count_frames",
         "-show_entries",
         "format=duration:stream=index,codec_type,nb_read_frames,start_time,duration",
         "-of",
         "json",
         output,
      ])
   );
   const duration = analysis.clip.end - analysis.clip.start;
   assert.ok(Math.abs(Number(decoded.format.duration) - duration) < 0.05, "Container duration matches the selection within an audio packet");
   assert.ok(Math.abs(Number(decoded.streams.find((stream) => stream.codec_type === "video")!.start_time)) < 0.002, "Video starts at zero");
   for (const stream of decoded.streams.filter((item) => item.codec_type === "audio")) {
      assert.ok(Number(stream.start_time) >= -0.002 && Number(stream.start_time) < 0.05, "Audio begins within one packet of video");
   }
   const expected = Math.round(duration * video.frameRate);
   assert.equal(
      Number(decoded.streams.find((stream) => stream.codec_type === "video")!.nb_read_frames),
      expected,
      "Output frame count must match the selection"
   );
   assert.equal(
      decoded.streams.filter((stream) => stream.codec_type === "audio").length,
      source.streams.filter((stream) => stream.type === "audio").length,
      "All audio tracks survive"
   );
   await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-f", "null", "-"]);
   const [originalFrames, resultFrames] = await Promise.all([
      runMedia("ffmpeg", [
         "-v",
         "error",
         "-ss",
         String(analysis.clip.start),
         "-i",
         path,
         "-t",
         String(duration),
         "-map",
         "0:v:0",
         "-an",
         "-f",
         "framemd5",
         "-",
      ]),
      runMedia("ffmpeg", ["-v", "error", "-i", output, "-map", "0:v:0", "-an", "-f", "framemd5", "-"]),
   ]);
   const originals = frameHashes(originalFrames);
   const results = frameHashes(resultFrames);
   assert.equal(results.length, originals.length);
   let identical = 0;
   for (const span of analysis.spans.filter((span) => !span.encode)) {
      const first = Math.round((span.start - analysis.clip.start) * video.frameRate);
      const last = Math.round((span.end - analysis.clip.start) * video.frameRate);
      for (let frame = first; frame < last; frame++) {
         assert.equal(results[frame], originals[frame], `Copied frame ${frame} changed or moved`);
         identical++;
      }
   }
   for (const offset of [0, (expected - 1) / video.frameRate]) {
      const score = await ssimScore({
         inputs: [
            "-v",
            "error",
            "-ss",
            String(Math.max(0, analysis.clip.start + offset - 0.001)),
            "-i",
            path,
            "-ss",
            String(Math.max(0, offset - 0.001)),
            "-i",
            output,
         ],
         filter: "[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file=work/media-test/quality.txt",
         statsPath: "work/media-test/quality.txt",
      });
      assert.ok(score > 0.95, `Boundary frame at ${offset}s does not match its source frame: SSIM ${score}`);
   }
   await assert.rejects(() => exportCut(source, analysis, output), "A repeated export must refuse to overwrite an existing file");
   console.log(
      `${expected} frames; ${identical} copied frames are pixel-identical; ${decoded.streams.length - 1} audio tracks; ${(Date.now() - started) / 1000}s including verification`
   );
}
assert.equal((await stat(path)).mtimeMs, before.mtimeMs, "Original was not modified");
console.log(
   "Media regression checks passed.",
   createHash("sha256")
      .update(await readFile("src/main/media/cut.ts"))
      .digest("hex")
      .slice(0, 12)
);
