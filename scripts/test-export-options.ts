import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import sharp from "sharp";
import { analyzeCut } from "../src/main/media/cut.ts";
import { resolve, join } from "node:path";
import { ExportService } from "../src/main/exports.ts";
import { probeSource, sourceKeyframes } from "../src/main/media/probe.ts";
import { exportFrame } from "../src/main/media/frame.ts";
import { runMedia } from "../src/main/media/process.ts";

const source = await probeSource(resolve("work/fixture.mp4"));
const directory = await mkdtemp(resolve("work/export-options-"));
const service = new ExportService(() => {});
for (const muteAudio of [false, true]) {
   const plan = await service.plan(source, {
      sourceId: source.id,
      directory,
      mode: "combined",
      audioTracks: muteAudio ? [] : null,
      name: `combined-${muteAudio}`,
      items: [
         { name: "later", clip: { id: "b", color: 1, start: 9.2, end: 14.7 } },
         { name: "earlier", clip: { id: "a", color: 0, start: 1.3, end: 6.7 } },
      ],
   });
   assert.equal(plan.items.length, 1);
   assert.notEqual(plan.items[0]!.method, "unsupported", plan.items[0]!.message);
   service.start(plan.id);
   await service.waitForIdle();
   assert.equal(service.current!.items[0]!.status, "completed", service.current!.items[0]!.error ?? "");
   const output = plan.items[0]!.outputPath;
   const media = await probeSource(output);
   assert.equal(media.streams.filter((stream) => stream.type === "audio").length, muteAudio ? 0 : 2);
   assert.ok(Math.abs(media.duration - 10.9) < 0.05, `Combined duration ${media.duration}`);
   await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", output, "-map", "0:v", "-map", "0:a?", "-f", "null", "-"]);
   const frames: { streams: { nb_read_frames: string }[] } = JSON.parse(
      await runMedia("ffprobe", ["-v", "error", "-select_streams", "v", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "json", output])
   );
   assert.equal(Number(frames.streams[0]!.nb_read_frames), 327);
   for (const [originalIndex, outputIndex] of [
      [39, 0],
      [200, 161],
      [276, 162],
      [440, 326],
   ]) {
      const stats = `work/combined-quality-${muteAudio}.txt`;
      await runMedia("ffmpeg", [
         "-v",
         "error",
         "-i",
         source.path,
         "-i",
         output,
         "-filter_complex",
         `[0:v]trim=start_frame=${originalIndex}:end_frame=${originalIndex! + 1},setpts=PTS-STARTPTS[a];[1:v]trim=start_frame=${outputIndex}:end_frame=${outputIndex! + 1},setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file=${stats}`,
         "-frames:v",
         "1",
         "-an",
         "-f",
         "null",
         "-",
      ]);
      assert.ok(Number(/All:([\d.]+)/.exec(await readFile(stats, "utf8"))?.[1]) > 0.94, "Joined boundary frame matches its source");
   }
   if (!muteAudio)
      for (const [originalTime, outputTime] of [
         [1.9, 0.6],
         [9.8, 6],
      ]) {
         const pcm = [join(directory, "source.pcm"), join(directory, "joined.pcm")];
         for (const [index, file, time] of [
            [0, source.path, originalTime!],
            [1, output, outputTime!],
         ] as const)
            await runMedia("ffmpeg", [
               "-v",
               "error",
               "-y",
               "-copyts",
               "-i",
               file,
               "-map",
               "0:a:0",
               "-af",
               `atrim=start=${time}:end=${time + 0.1},asetpts=PTS-STARTPTS`,
               "-f",
               "s16le",
               pcm[index]!,
            ]);
         const [a, b] = await Promise.all(pcm.map((path) => readFile(path)));
         assert.equal(a!.length, b!.length);
         // MP4 edit lists use millisecond timestamps; permit less than 1 ms rounding.
         let bestRms = Infinity;
         let bestShift = 0;
         for (let shift = -48; shift <= 48; shift++) {
            let squares = 0;
            let count = 0;
            for (let i = 96; i < a!.length / 2 - 96; i++) {
               squares += (a!.readInt16LE(i * 2) - b!.readInt16LE((i + shift) * 2)) ** 2;
               count++;
            }
            const rms = Math.sqrt(squares / count);
            if (rms < bestRms) {
               bestRms = rms;
               bestShift = shift;
            }
         }
         assert.ok(bestRms < 10, `Audio remains synchronized after the join: RMS ${bestRms}, shift ${bestShift}`);
         console.log("Audio alignment", originalTime, "→", outputTime, bestShift, "samples");
      }
   console.log("PASS combined", muteAudio ? "muted" : "all tracks");
}
const whole = await service.plan(source, {
   sourceId: source.id,
   directory,
   audioTracks: [],
   items: [{ name: "whole-muted", clip: { id: "whole", color: 0, start: 0, end: source.duration } }],
});
service.start(whole.id);
await service.waitForIdle();
assert.equal(service.current!.items[0]!.status, "completed", service.current!.items[0]!.error ?? "");
assert.equal((await probeSource(whole.items[0]!.outputPath)).streams.filter((stream) => stream.type === "audio").length, 0);
const keys = await sourceKeyframes(source);
assert.ok(keys.length >= 4);
// Packet time bases can represent 4 seconds as 3.9999999999999996.
for (const [index, expected] of [0, 2, 4, 6].entries()) assert.ok(Math.abs(keys[index]! - expected) < 1e-9, `Keyframe ${index} is at ${expected}s`);
assert.equal((await analyzeCut(source, { id: "snap", color: 0, start: 2, end: 12 })).method, "copy");
for (const format of ["png", "jpg"] as const) {
   const path = await exportFrame(source, { sourceId: source.id, time: 1.3, directory, name: "frame", format, quality: 95 });
   assert.ok((await readFile(path)).length > 1000);
   const duplicate = await exportFrame(source, { sourceId: source.id, time: 1.3, directory, name: "frame", format, quality: 95 });
   assert.notEqual(path, duplicate);
   await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", path, "-f", "null", "-"]);
   const quality = join(directory, `quality-${format}.txt`)
      .replaceAll("\\", "/")
      .replace(/^([A-Za-z]):/, "$1\\:");
   await runMedia("ffmpeg", [
      "-v",
      "error",
      "-ss",
      "1.3",
      "-i",
      source.path,
      "-i",
      path,
      "-filter_complex",
      `[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]ssim=stats_file='${quality}'`,
      "-frames:v",
      "1",
      "-an",
      "-f",
      "null",
      "-",
   ]);
   assert.ok(Number(/All:([\d.]+)/.exec(await readFile(join(directory, `quality-${format}.txt`), "utf8"))?.[1]) > 0.94);
}
console.log("PASS full-file mute, keyframes, PNG/JPEG frame export and collisions");
const multiTrackSource = await probeSource(resolve("work/details/multiple-tracks.mkv"));
const chosenAudio = multiTrackSource.streams.filter((stream) => stream.type === "audio")[1]!;
const selectedPlan = await service.plan(multiTrackSource, {
   sourceId: multiTrackSource.id,
   directory,
   mode: "combined",
   audioTracks: [chosenAudio.index],
   name: "selected-audio-track",
   items: [
      { name: "one", clip: { id: "one-audio", color: 0, start: 1.25, end: 3.75 } },
      { name: "two", clip: { id: "two-audio", color: 1, start: 5.25, end: 8.75 } },
   ],
});
service.start(selectedPlan.id);
await service.waitForIdle();
assert.equal(service.current!.items[0]!.status, "completed", service.current!.items[0]!.error ?? "");
const selectedOutputAudio = (await probeSource(selectedPlan.items[0]!.outputPath)).streams.filter((stream) => stream.type === "audio");
assert.equal(selectedOutputAudio.length, 1);
assert.equal(selectedOutputAudio[0]!.title, chosenAudio.title);
assert.equal(selectedOutputAudio[0]!.language, chosenAudio.language);
assert.equal(selectedOutputAudio[0]!.codec, chosenAudio.codec);
console.log("PASS selected audio track copied with metadata");
for (const input of [
   "formats/vp9.webm",
   "formats/hevc-hdr10.mkv",
   "formats/av1.mp4",
   "formats/prores.mov",
   "formats/h264-silent.mp4",
   "details/multiple-tracks.mkv",
   "details/rotated.mov",
]) {
   const media = await probeSource(resolve("work", input));
   const plan = await service.plan(media, {
      sourceId: media.id,
      directory,
      mode: "combined",
      name: input.replaceAll("/", "-"),
      items: [
         { name: "one", clip: { id: "one", color: 0, start: 1.25, end: 3.75 } },
         { name: "two", clip: { id: "two", color: 1, start: 5.25, end: 8.75 } },
      ],
   });
   service.start(plan.id);
   await service.waitForIdle();
   assert.equal(service.current!.items[0]!.status, "completed", service.current!.items[0]!.error ?? "");
   const joined = await probeSource(plan.items[0]!.outputPath);
   const sourceVideo = media.streams.find((stream) => stream.type === "video")!;
   const joinedVideo = joined.streams.find((stream) => stream.type === "video")!;
   assert.equal(joinedVideo.rotation, sourceVideo.rotation);
   assert.equal(joinedVideo.pixelFormat, sourceVideo.pixelFormat);
   if (sourceVideo.masterDisplay) assert.equal(joinedVideo.masterDisplay, sourceVideo.masterDisplay);
   assert.equal(joined.streams.filter((stream) => stream.type === "audio").length, media.streams.filter((stream) => stream.type === "audio").length);
   assert.ok(Math.abs(joined.duration - 6) < 0.1, `Joined duration for ${input}: ${joined.duration}`);
   if (media.chapters.length) {
      assert.equal(joined.chapters.length, 2);
      assert.ok(Math.abs(joined.chapters[1]!.start - 2.5) < 0.05);
   }
   assert.equal(joined.streams.filter((stream) => stream.type === "attachment").length, media.streams.filter((stream) => stream.type === "attachment").length);
   assert.equal(joined.streams.filter((stream) => stream.type === "subtitle").length, media.streams.filter((stream) => stream.type === "subtitle").length);
   if (media.streams.some((stream) => stream.title === "Commentary")) {
      assert.equal(joined.streams.find((stream) => stream.title === "Commentary")?.language, "nld");
      assert.equal(joined.streams.find((stream) => stream.type === "subtitle")?.disposition["forced"], 1);
   }
   await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", joined.path, "-map", "0:v", "-map", "0:a?", "-f", "null", "-"]);
   console.log("PASS combined", input);
}
for (const input of ["formats/hevc-hdr10.mkv", "details/rotated.mov"]) {
   const media = await probeSource(resolve("work", input));
   const video = media.streams.find((stream) => stream.type === "video")!;
   for (const format of ["png", "jpg"] as const) {
      const output = await exportFrame(media, {
         sourceId: media.id,
         time: 1.25,
         directory,
         name: input.replaceAll("/", "-"),
         format,
         quality: 95,
      });
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.width, Math.abs(video.rotation) % 180 === 90 ? video.height : video.width);
      assert.equal(metadata.height, Math.abs(video.rotation) % 180 === 90 ? video.width : video.height);
      const stats = await sharp(output).stats();
      assert.ok(
         stats.channels.some((channel) => channel.stdev > 10),
         "Frame contains a visible image"
      );
   }
   console.log("PASS frame colors/dimensions", input);
}
const cancelPlan = await service.plan(source, {
   sourceId: source.id,
   directory,
   mode: "combined",
   name: "cancel-retry",
   items: [
      { name: "a", clip: { id: "a", color: 0, start: 1.3, end: 6.7 } },
      { name: "b", clip: { id: "b", color: 1, start: 9.2, end: 14.7 } },
   ],
});
service.start(cancelPlan.id);
service.cancel();
await service.waitForIdle();
assert.equal(service.current!.items[0]!.status, "cancelled");
assert.ok(!(await readdir(directory)).some((name) => name.startsWith(".attacut-")));
service.retry(service.current!.id);
await service.waitForIdle();
assert.equal(service.current!.items[0]!.status, "completed", service.current!.items[0]!.error ?? "");
assert.ok(!(await readdir(directory)).some((name) => name.startsWith(".attacut-")));
console.log("PASS combined cancellation, cleanup and retry");
