import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runMedia, ffmpegBase } from "../src/main/media/process.ts";
import { probeSource } from "../src/main/media/probe.ts";
import { analyzeCut, exportCut } from "../src/main/media/cut.ts";
import { preparePreview } from "../src/main/media/preview.ts";
const folder = resolve("work/details");
await mkdir(folder, { recursive: true });
await writeFile(join(folder, "captions.srt"), "1\n00:00:00,500 --> 00:00:03,000\nAcross the start\n\n2\n00:00:07,000 --> 00:00:09,500\nAcross the end\n");
await writeFile(
   join(folder, "chapters.txt"),
   ";FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=5000\ntitle=First\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=5000\nEND=10000\ntitle=Second\n"
);
await writeFile(join(folder, "attachment.txt"), "An attachment that must survive unchanged.");
const sourcePath = join(folder, "multiple-tracks.mkv");
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-i",
   "work/formats/h264.mp4",
   "-i",
   join(folder, "captions.srt"),
   "-f",
   "ffmetadata",
   "-i",
   join(folder, "chapters.txt"),
   "-map",
   "0:v",
   "-map",
   "0:a",
   "-map",
   "0:a",
   "-map",
   "0:a",
   "-map",
   "0:a",
   "-map",
   "1:s",
   "-map_chapters",
   "2",
   "-c:v",
   "copy",
   "-c:a:0",
   "aac",
   "-c:a:1",
   "libopus",
   "-c:a:2",
   "ac3",
   "-c:a:3",
   "flac",
   "-c:s",
   "ass",
   "-metadata:s:a:1",
   "title=Commentary",
   "-metadata:s:a:1",
   "language=nld",
   "-disposition:a:1",
   "default",
   "-disposition:s:0",
   "forced",
   "-attach",
   join(folder, "attachment.txt"),
   "-metadata:s:t:0",
   "mimetype=text/plain",
   sourcePath,
]);
const source = await probeSource(sourcePath);
const analysis = await analyzeCut(source, { id: "x", color: 0, start: 1.25, end: 8.75 });
assert.notEqual(analysis.method, "unsupported", analysis.message);
const output = join(folder, "trimmed.mkv");
await rm(output, { force: true });
await exportCut(source, analysis, output);
const result = await probeSource(output);
assert.equal(result.streams.filter((stream) => stream.type === "audio").length, 4);
assert.equal(result.streams.find((stream) => stream.title === "Commentary")?.language, "nld");
assert.equal(result.streams.find((stream) => stream.type === "subtitle")?.disposition["forced"], 1);
assert.equal(result.streams.filter((stream) => stream.type === "attachment").length, 1);
assert.equal(result.chapters.length, 2);
assert.equal(result.chapters[0]!.start, 0);
assert.ok(Math.abs(result.chapters[1]!.end - (analysis.clip.end - analysis.clip.start)) < 0.002);
const subtitles = await runMedia("ffmpeg", ["-v", "error", "-i", output, "-map", "0:s:0", "-c:s", "srt", "-f", "srt", "-"]);
assert.match(subtitles, /00:00:00,000 --> 00:00:01,750/);
// The cue crosses the selected end, so it must stop at the 7.5-second clip boundary.
assert.match(subtitles, /00:00:05,750 --> 00:00:07,500/);
await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-map", "0:v", "-map", "0:a", "-f", "null", "-"]);
for (let index = 0; index < 4; index++) {
   const files = [join(folder, `reference-${index}.pcm`), join(folder, `output-${index}.pcm`)];
   for (const [path, file, time] of [
      [source.path, files[0]!, analysis.clip.start + source.startOffset + 0.5],
      [output, files[1]!, 0.5],
   ] as const) {
      await runMedia("ffmpeg", [
         ...ffmpegBase,
         "-copyts",
         "-i",
         path,
         "-map",
         `0:a:${index}`,
         "-af",
         `atrim=start=${time}:end=${time + 0.25},asetpts=PTS-STARTPTS`,
         "-ac",
         "1",
         "-ar",
         "48000",
         "-f",
         "s16le",
         file,
      ]);
   }
   const [reference, actual] = await Promise.all(files.map((file) => readFile(file)));
   assert.equal(reference!.length, actual!.length, `audio ${index} sample count`);
   // Matroska timestamps have millisecond precision. Opus pre-skip can round
   // the first decoded timestamp differently after remuxing. Allow at most 1ms.
   let best = { rms: Infinity, samples: 0 };
   const margin = 96;
   for (let shift = -48; shift <= 48; shift++) {
      let squares = 0;
      const count = reference!.length / 2 - margin * 2;
      for (let n = margin; n < count + margin; n++) squares += (reference!.readInt16LE(n * 2) - actual!.readInt16LE((n + shift) * 2)) ** 2;
      const rms = Math.sqrt(squares / count);
      if (rms < best.rms) best = { rms, samples: shift };
   }
   assert.ok(best.rms < 10, `audio ${index} alignment, RMS difference ${best.rms}`);
   console.log(`Audio ${index}: ${best.samples / 48}ms rounding, RMS ${best.rms.toFixed(3)}`);
}
const delayedPath = join(folder, "delayed-audio.mkv");
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-i",
   "work/formats/h264.mp4",
   "-itsoffset",
   "3",
   "-i",
   "work/formats/h264.mp4",
   "-map",
   "0:v",
   "-map",
   "1:a",
   "-c:v",
   "copy",
   "-c:a",
   "flac",
   "-t",
   "10",
   delayedPath,
]);
const delayedSource = await probeSource(delayedPath);
const delayedCut = await analyzeCut(delayedSource, { id: "delay", color: 0, start: 1.25, end: 8.75 });
const delayedOutput = join(folder, "delayed-cut.mkv");
await rm(delayedOutput, { force: true });
await exportCut(delayedSource, delayedCut, delayedOutput);
async function audioStart(path: string): Promise<number> {
   const data: { streams: { start_time: string }[] } = JSON.parse(
      await runMedia("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=start_time", "-of", "json", path])
   );
   return Number(data.streams[0]!.start_time);
}
assert.ok(
   Math.abs((await audioStart(delayedOutput)) - ((await audioStart(delayedPath)) - delayedSource.startOffset - delayedCut.clip.start)) < 0.002,
   "Intentional delayed audio remains delayed"
);
const rotated = join(folder, "rotated.mov");
for (const [input, extension, codec] of [
   ["h264.mp4", ".mp4", "mov_text"],
   ["vp9.webm", ".webm", "webvtt"],
] as const) {
   const path = join(folder, `captions${extension}`);
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-i",
      `work/formats/${input}`,
      "-i",
      join(folder, "captions.srt"),
      "-map",
      "0:v",
      "-map",
      "0:a",
      "-map",
      "1:s",
      "-c",
      "copy",
      "-c:s",
      codec,
      path,
   ]);
   const media = await probeSource(path);
   const cut = await analyzeCut(media, { id: "captions", color: 0, start: 1.25, end: 8.75 });
   const target = join(folder, `captions-cut${extension}`);
   await rm(target, { force: true });
   await exportCut(media, cut, target);
   const captions = await runMedia("ffmpeg", ["-v", "error", "-i", target, "-map", "0:s:0", "-c:s", "srt", "-f", "srt", "-"]);
   assert.match(captions, /Across the start/);
   assert.match(captions, /Across the end/);
   const firstEnd = /00:00:00,000 --> 00:00:(\d{2}),(\d{3})/.exec(captions);
   assert.ok(firstEnd);
   assert.ok(
      Math.abs(Number(`${firstEnd[1]}.${firstEnd[2]}`) - (3 - media.startOffset - cut.clip.start)) <= 0.01,
      "Caption timing follows the selected source frame"
   );
   assert.equal((await probeSource(target)).streams.find((stream) => stream.type === "subtitle")?.codec, codec);
}
const gapCut = await analyzeCut(source, { id: "gap", color: 0, start: 4.2, end: 6.5 });
const gapOutput = join(folder, "subtitle-gap.mkv");
await rm(gapOutput, { force: true });
await exportCut(source, gapCut, gapOutput);
assert.equal(await runMedia("ffmpeg", ["-v", "error", "-i", gapOutput, "-map", "0:s:0", "-c:s", "srt", "-f", "srt", "-"]), "");
await runMedia("ffmpeg", [...ffmpegBase, "-display_rotation:v:0", "90", "-i", "work/formats/h264.mp4", "-map", "0", "-c", "copy", rotated]);
const rotationSource = await probeSource(rotated);
const rotationCut = await analyzeCut(rotationSource, { id: "r", color: 0, start: 1.25, end: 8.75 });
const rotationOutput = join(folder, "rotated-cut.mov");
await rm(rotationOutput, { force: true });
await exportCut(rotationSource, rotationCut, rotationOutput);
assert.equal((await probeSource(rotationOutput)).streams[0]!.rotation, rotationSource.streams[0]!.rotation);
const hdr = await probeSource(resolve("work/formats/hevc-hdr10.mkv"));
const preview = await preparePreview(
   hdr,
   join(folder, "previews"),
   hdr.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index),
   true,
   {}
);
const display = await probeSource(preview.path);
assert.equal(display.streams[0]!.pixelFormat, "yuv420p");
assert.equal(display.streams[0]!.colorTransfer, "bt709");
await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", preview.path, "-f", "null", "-"]);
console.log("PASS: mixed audio codecs, track titles/language/disposition, overlapping subtitles, clipped chapters, attachments, rotation, HDR preview.");
