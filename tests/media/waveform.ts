import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runMedia, ffmpegBase } from "../../src/main/media/process.ts";
import { probeSource } from "../../src/main/media/probe.ts";
import { preparePreview } from "../../src/main/media/preview.ts";
import { decodeWaveform } from "../../src/main/media/waveform-decode.ts";
import type { ProbedSource } from "../../src/main/media/probe.ts";
import { SourceSession } from "../../src/main/source-session.ts";
import { extractScrubPcm } from "../../src/main/media/scrub-audio.ts";

const folder = await mkdtemp(resolve("work/waveform-media-"));
const path = join(folder, "tracks.mkv");
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-f",
   "lavfi",
   "-i",
   "testsrc2=size=128x72:rate=30:duration=5",
   "-f",
   "lavfi",
   "-i",
   "anullsrc=r=48000:cl=stereo:d=5",
   "-f",
   "lavfi",
   "-i",
   "aevalsrc=if(between(t\\,2\\,3)\\,0.5*sin(2*PI*440*t)\\,0):s=48000:d=5",
   "-itsoffset",
   "1",
   "-f",
   "lavfi",
   "-i",
   "sine=frequency=660:sample_rate=48000:duration=4",
   "-map",
   "0:v",
   "-map",
   "1:a",
   "-map",
   "2:a",
   "-map",
   "3:a",
   "-c:v",
   "libx264",
   "-preset",
   "ultrafast",
   "-c:a",
   "pcm_s16le",
   path,
]);
const source = await probeSource(path);
async function peaksOf(source: ProbedSource, tracks: number[], decodePath?: string) {
   const chunks: Uint8Array[] = [];
   let done = 0;
   const result = await decodeWaveform(
      source,
      tracks,
      undefined,
      async (chunk) => {
         assert.equal(chunk.offset, done);
         done += chunk.peaks.length / 3;
         chunks.push(chunk.peaks.slice());
      },
      decodePath ? { decodePath } : {}
   );
   assert.ok(result);
   assert.equal(result.buckets, Math.ceil(source.duration * result.rate));
   const peaks = new Uint8Array(done * 3);
   let at = 0;
   for (const chunk of chunks) {
      peaks.set(chunk, at);
      at += chunk.length;
   }
   return peaks;
}
const silence = await peaksOf(source, [1]);
assert.ok(silence.every((value) => value === 0));
const tone = await peaksOf(source, [2]);
assert.ok(
   tone.subarray(500 * 3, 1500 * 3).every((value) => value === 0),
   "Silence before the burst retains its position"
);
assert.ok(tone[2500 * 3 + 2]! > 140, "The burst remains at 2.5 seconds");
assert.ok(tone.subarray(3500 * 3, 4500 * 3).every((value) => value === 0));
const delayed = await peaksOf(source, [3]);
assert.ok(
   delayed.subarray(0, 900 * 3).every((value) => value === 0),
   "Delayed audio must not move to zero"
);
assert.ok(delayed[1500 * 3 + 2]! > 40);
const mixed = await peaksOf(source, [1, 2]);
assert.ok(mixed[2500 * 3 + 2]! < tone[2500 * 3 + 2]! && mixed[2500 * 3 + 2]! > 70);
const preview = await preparePreview(source, join(folder, "previews"), [1, 2], false, {});
const originalMix = await peaksOf(source, [1, 2]);
const previewMix = await peaksOf(source, [1, 2], preview.path);
assert.ok(
   previewMix.subarray(0, 900 * 3).every((value) => value === 0),
   "An aligned preview retains burst timing"
);
const averageCore = (peaks: Uint8Array) =>
   Array.from({ length: 100 }, (_, index) => peaks[(2400 + index) * 3 + 2]!).reduce((sum, value) => sum + value, 0) / 100;
assert.ok(
   Math.abs(averageCore(originalMix) - averageCore(previewMix)) < 5,
   `The preview maps its single mixed audio stream, ${averageCore(originalMix)} vs ${averageCore(previewMix)}`
);
const delayedPreview = await preparePreview(source, join(folder, "previews"), [3], false, {});
const previewDelay = await peaksOf(source, [3], delayedPreview.path);
assert.ok(
   previewDelay.subarray(0, 900 * 3).every((value) => value === 0),
   "A single delayed preview retains its offset"
);
const session = new SourceSession(join(folder, "previews"));
const active = await session.open(path);
await session.prepare(active.id, [2, 3], false);
const alignedPreview = session.waveformDecodePath([2, 3]);
assert.ok(alignedPreview, "Aligned mixes can reuse the compact preview");
const originalDelayedMix = await peaksOf(source, [2, 3]);
for (const [tracks, reference] of [
   [[2], tone],
   [[3], delayed],
   [[2, 3], originalDelayedMix],
] as const) {
   for (const range of [
      { from: 0.5, to: 1.5 },
      { from: 2.25, to: 2.75 },
   ]) {
      const chunks: Uint8Array[] = [];
      let offset = Math.round(range.from * 1000);
      const result = await decodeWaveform(
         source,
         [...tracks],
         undefined,
         async (chunk) => {
            assert.equal(chunk.offset, offset, "Priority peaks retain their source position");
            offset += chunk.peaks.length / 3;
            chunks.push(chunk.peaks.slice());
         },
         { range }
      );
      assert.ok(result);
      const region = Buffer.concat(chunks);
      assert.equal(result.buckets, Math.round((range.to - range.from) * 1000));
      // Seeking restarts the resampler. Its initial settling samples do not describe
      // the interior, which must agree with the full timestamp-aligned scan.
      const from = Math.round(range.from * 1000);
      const expected = reference.subarray((from + 10) * 3, (offset - 10) * 3);
      const actual = region.subarray(10 * 3, region.length - 10 * 3);
      assert.equal(actual.length, expected.length);
      const errors = Array.from(actual, (value, i) => Math.abs(value - expected[i]!));
      // Restarting a resampler can change a one-millisecond bucket's extrema by a
      // few display levels. Timing and overall energy must remain consistent.
      assert.ok(
         Math.max(...errors) <= 6 && errors.reduce((a, b) => a + b, 0) / errors.length < 1,
         `Priority interiors match full scan: tracks ${tracks}, range ${JSON.stringify(range)}, max ${Math.max(...errors)}`
      );
   }
}
const preparedDelayedMix = await peaksOf(source, [2, 3], alignedPreview);
assert.ok(
   preparedDelayedMix.subarray(0, 900 * 3).every((value) => value === 0),
   "Mixing does not move delayed audio to zero"
);
assert.ok(Math.abs(averageCore(originalDelayedMix) - averageCore(preparedDelayedMix)) < 5, "Preview and waveform have the same delayed mix gain");
for (const tracks of [[3], [1, 3]]) {
   const pcm = await extractScrubPcm(source, tracks);
   assert.ok(pcm);
   const view = new Int16Array(pcm.pcm);
   assert.ok(
      view.subarray(0, 22050 * 0.9).every((value) => value === 0),
      "Scrub audio preserves delayed input silence"
   );
   assert.ok(
      view.subarray(22050 * 1.4, 22050 * 1.6).some((value) => Math.abs(value) > 100),
      "Scrubbing retains delayed audio at its source time"
   );
   const sought = await extractScrubPcm(source, tracks, undefined, 2);
   assert.ok(sought && sought.pcm.byteLength === 22050 * 2 * 3);
   assert.ok(
      new Int16Array(sought.pcm).subarray(100, 1000).some((value) => Math.abs(value) > 100),
      "A cold chunk starts at the requested source time"
   );
}
session.dispose();
const controller = new AbortController();
await assert.rejects(
   decodeWaveform(source, [2], controller.signal, async () => {
      controller.abort();
   }),
   /Cancelled/
);
console.log("Waveform media checks passed: silence, burst timing, delayed track, mix, prepared preview, cancellation.");
