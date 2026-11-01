import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ffmpegBase, runMedia } from "../../src/main/media/process";
import { probeSource } from "../../src/main/media/probe";
import { analyzeCut, exportCut } from "../../src/main/media/cut";
import { ffconcatList } from "../../src/main/media/mux";
import { verifyCutFrames } from "../../src/main/media/verify";

const folder = await mkdtemp(resolve("work/verification-"));
try {
   const original = join(folder, "original.mp4");
   const changed = join(folder, "changed.mp4");
   const short = join(folder, "short.mp4");
   const firstChanged = join(folder, "first-changed.mp4");
   for (const [path, input, duration] of [
      [original, "testsrc2=size=64x64:rate=30", "14"],
      [changed, "color=black:size=64x64:rate=30", "14"],
   ] as const)
      await runMedia("ffmpeg", [...ffmpegBase, "-f", "lavfi", "-i", input, "-t", duration, "-c:v", "libx264", "-preset", "ultrafast", path]);
   await runMedia("ffmpeg", [...ffmpegBase, "-i", original, "-t", "0.1", "-c", "copy", short]);
   await runMedia("ffmpeg", [
      ...ffmpegBase,
      "-i",
      original,
      "-vf",
      "drawbox=color=black:t=fill:enable='eq(n,30)'",
      "-c:v",
      "libx264",
      "-crf",
      "0",
      "-preset",
      "ultrafast",
      firstChanged,
   ]);
   const source = await probeSource(original);
   const changedSource = await probeSource(changed);
   const shortSource = await probeSource(short);
   const firstChangedSource = await probeSource(firstChanged);
   // Distant endpoints exercise separate bounded reads. Repetition exercises cached
   // source hashes, including batches that need no source decoder at all.
   for (let repeat = 0; repeat < 2; repeat++) {
      await verifyCutFrames(source, source, 0, [0, 1, 13], [0, 1, 13]);
      await verifyCutFrames(source, source, 0, [0, 1, 13]);
   }
   await assert.rejects(verifyCutFrames(source, changedSource, 0, [1], []), /changing copied video/);
   await assert.rejects(verifyCutFrames(source, changedSource, 0, [], [1]), /encoded boundary/);
   await assert.rejects(verifyCutFrames(source, firstChangedSource, 0, [], [1]), /encoded boundary/);
   // A good early frame must never conceal a missing later frame or a failed check.
   await assert.rejects(verifyCutFrames(source, shortSource, 0, [], [0, 1]), /encoded boundary/);
   await assert.rejects(verifyCutFrames(source, shortSource, 0, [1], []), /verify a frame/);
   await assert.rejects(verifyCutFrames(source, source, 0, [1], [1], AbortSignal.abort()));
   const rgbPaths = [join(folder, "rgb.mp4"), join(folder, "rgb-changed.mp4")];
   for (const [index, path] of rgbPaths.entries())
      await runMedia("ffmpeg", [
         ...ffmpegBase,
         "-f",
         "lavfi",
         "-i",
         `nullsrc=s=64x64:r=30,format=gbrp,geq=r=${128 + index}:g=128:b=128`,
         "-t",
         "0.1",
         "-c:v",
         "libx264rgb",
         "-crf",
         "0",
         "-preset",
         "ultrafast",
         path,
      ]);
   const rgb = await probeSource(rgbPaths[0]!);
   const rgbChanged = await probeSource(rgbPaths[1]!);
   // SSIM conversion must not hide a one-level RGB change from the exact copy check.
   await assert.rejects(verifyCutFrames(rgb, rgbChanged, 0, [0], [0]), /changing copied video/);
   await verifyCutFrames(rgb, rgb, 0, [0], [0]);
   const parts = [join(folder, "wide.webm"), join(folder, "tall.webm")];
   for (const [index, size] of ["96x64", "64x96"].entries())
      await runMedia("ffmpeg", [...ffmpegBase, "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=10:duration=1`, "-c:v", "libvpx", "-g", "1", parts[index]!]);
   const list = join(folder, "sizes.ffconcat");
   await writeFile(list, ffconcatList(parts, [1, 1]));
   const resizing = join(folder, "resizing.webm");
   await runMedia("ffmpeg", [...ffmpegBase, "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", resizing]);
   const unfinished = join(folder, "unfinished.webm");
   const bytes = await readFile(resizing);
   const durationOffset = bytes.indexOf(Buffer.from([0x44, 0x89, 0x88]));
   assert.ok(durationOffset >= 0, "Fixture contains a Matroska duration element");
   bytes.writeDoubleBE(0, durationOffset + 3);
   await writeFile(unfinished, bytes);
   const recovered = await probeSource(unfinished);
   assert.ok(Math.abs(recovered.duration - 2) < 0.01, `Recovered packet duration ${recovered.duration}`);
   const resizingSource = await probeSource(resizing);
   await verifyCutFrames(resizingSource, resizingSource, 0, [0.2, 1.2, 1.8]);
   const resizingCut = join(folder, "resizing-cut.webm");
   await exportCut(resizingSource, await analyzeCut(resizingSource, { id: "sizes", color: 0, start: 0.2, end: 1.8 }), resizingCut);
   await runMedia("ffmpeg", ["-v", "error", "-xerror", "-i", resizingCut, "-f", "null", "-"]);
   console.log("PASS copied cuts retain changing video dimensions without resetting frame checks");
   console.log("Frame verification passed: grouped reads, cached references, changed copied frames, failed quality checks, missing frames, and cancellation.");
} finally {
   await rm(folder, { recursive: true, force: true });
}
