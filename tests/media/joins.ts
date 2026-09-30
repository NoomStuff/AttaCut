import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ffmpegBase, runMedia } from "../../src/main/media/process";
import { probeSource, ratio } from "../../src/main/media/probe";
import { ExportService } from "../../src/main/exports";

const folder = resolve("work/audio-joins");
await mkdir(folder, { recursive: true });
const path = join(folder, "impulses.mkv");
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-f",
   "lavfi",
   "-i",
   "testsrc2=size=64x64:rate=30",
   "-f",
   "lavfi",
   "-i",
   "aevalsrc=0.2*sin(2*PI*440*t)+0.5*lt(mod(t\\,0.1)\\,1/48000):s=48000",
   "-itsoffset",
   "0.2",
   "-f",
   "lavfi",
   "-i",
   "aevalsrc=0.2*sin(2*PI*880*t)+0.5*lt(mod(t\\,0.13)\\,1/48000):s=48000",
   "-map",
   "0:v",
   "-map",
   "1:a",
   "-map",
   "2:a",
   "-t",
   "6",
   "-c:v",
   "libx264",
   "-preset",
   "ultrafast",
   "-g",
   "30",
   "-c:a",
   "pcm_s16le",
   path,
]);
const source = await probeSource(path);
const ranges = [
   [0.5, 1.5],
   [2.5, 3.5],
   [4.5, 5.5],
] as const;
const service = new ExportService(() => {});
const plan = await service.plan(source, {
   sourceId: source.id,
   directory: folder,
   name: "joined",
   mode: "combined",
   items: ranges.map(([start, end], index) => ({ name: String(index), clip: { id: String(index), color: index, start, end } })),
});
service.start(plan.id, { overwrite: true });
await service.waitForIdle();
assert.equal(service.current?.items[0]?.status, "completed", service.current?.items[0]?.error ?? "Combined export did not complete");
const output = plan.items[0]!.outputPath;
for (const [index, stream] of source.streams.filter((stream) => stream.type === "audio").entries()) {
   const files = [join(folder, `source-${index}.pcm`), join(folder, `joined-${index}.pcm`)];
   for (const [input, file] of [
      [path, files[0]!],
      [output, files[1]!],
   ])
      await runMedia("ffmpeg", [...ffmpegBase, "-i", input!, "-map", `0:a:${index}`, "-f", "s16le", file!]);
   const [original, joined] = await Promise.all(files.map((file) => readFile(file)));
   const origin = (stream.startTime ?? source.startOffset) - source.startOffset;
   // Matroska rounds packet times to its time base. Require exact PCM throughout
   // each clip, allowing only that timestamp quantum, with no accumulated drift.
   const rounding = Math.ceil(ratio(stream.timeBase) * 48000);
   assert.equal(joined!.length, ranges.length * 48000 * 2);
   for (const [clipIndex, [start, end]] of ranges.entries()) {
      const actual = joined!.subarray(clipIndex * 48000 * 2, (clipIndex + 1) * 48000 * 2);
      let matched = false;
      for (let shift = -rounding; shift <= rounding; shift++) {
         const reference = original!.subarray((Math.round((start - origin) * 48000) + shift) * 2, (Math.round((end - origin) * 48000) + shift) * 2);
         if (actual.equals(reference)) {
            matched = true;
            break;
         }
      }
      assert.ok(matched, `Audio track ${index}, clip ${clipIndex} preserves every sample within its timestamp quantum`);
   }
}
console.log("PASS impulses, distinct tones and delayed audio through every combined join");
