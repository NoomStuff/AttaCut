import { expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mediaBinary } from "./app.mjs";
const run = promisify(execFile);

export async function expectFrameMatches(source, sourceTime, output, outputTime = 0) {
   const { stderr } = await run(
      mediaBinary("ffmpeg"),
      [
         "-hide_banner",
         "-ss",
         String(sourceTime),
         "-i",
         source,
         "-ss",
         String(outputTime),
         "-i",
         output,
         "-filter_complex",
         "[0:V:0]setpts=PTS-STARTPTS[a];[1:V:0]setpts=PTS-STARTPTS[b];[a][b]ssim",
         "-frames:v",
         "1",
         "-an",
         "-f",
         "null",
         "-",
      ],
      { windowsHide: true }
   );
   const score = Number(/All:([\d.]+)/.exec(stderr)?.[1]);
   expect(score, `frame ${sourceTime}s -> ${outputTime}s`).toBeGreaterThan(0.94);
}

export async function inspectMedia(path) {
   const { stdout } = await run(mediaBinary("ffprobe"), ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path], {
      windowsHide: true,
   });
   return JSON.parse(stdout);
}

export async function expectAudioMatches(source, sourceTime, output, outputTime, track) {
   async function samples(path, time) {
      const { stdout } = await run(
         mediaBinary("ffmpeg"),
         ["-v", "error", "-ss", String(time), "-i", path, "-map", `0:a:${track}`, "-t", "0.25", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"],
         { windowsHide: true, encoding: "buffer", maxBuffer: 1024 * 1024 }
      );
      const pcm = Array.from({ length: stdout.length / 4 }, (_, index) => stdout.readFloatLE(index * 4));
      const rms = Math.sqrt(pcm.reduce((sum, value) => sum + value * value, 0) / pcm.length);
      const crossings = pcm.reduce((sum, value, index) => sum + (index > 0 && value > 0 && pcm[index - 1] <= 0 ? 1 : 0), 0);
      return { rms, frequency: crossings / (pcm.length / 48000) };
   }
   const original = await samples(source, sourceTime);
   const actual = await samples(output, outputTime);
   expect(original.rms).toBeGreaterThan(0.05);
   expect(actual.rms).toBeCloseTo(original.rms, 2);
   expect(Math.abs(actual.frequency - original.frequency)).toBeLessThan(10);
}

export async function expectCopiedFrameMatches(source, sourceTime, output, outputTime) {
   async function hash(path, time) {
      const { stdout } = await run(
         mediaBinary("ffmpeg"),
         ["-v", "error", "-ss", String(time), "-i", path, "-map", "0:V:0", "-frames:v", "1", "-f", "framemd5", "-"],
         { windowsHide: true }
      );
      const frames = stdout.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
      expect(frames).toHaveLength(1);
      const result = frames[0].split(",").at(-1).trim();
      expect(result).toMatch(/^[0-9a-f]{32}$/);
      return result;
   }
   const [original, actual] = await Promise.all([hash(source, sourceTime), hash(output, outputTime)]);
   expect(actual, `copied frame ${sourceTime}s -> ${outputTime}s`).toBe(original);
}
