import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { primaryVideo } from "../../src/shared/types";
import { runMedia, ffmpegBase } from "../../src/main/media/process";
import { probeSource } from "../../src/main/media/probe";
import { analyzeCut, exportCut } from "../../src/main/media/cut";
import { exportCombined } from "../../src/main/media/combine";
import { verifyOutputStructure } from "../../src/main/media/verify";

const folder = resolve("work/aspect-ratios");
await mkdir(folder, { recursive: true });
for (const [codec, encoder, size] of [
   ["h264", "libx264", "160x120"],
   ["h264", "libx264", "720x542"],
   ["hevc", "libx265", "160x120"],
] as const) {
   for (const sar of ["1:1", "4:3"]) {
      const containerOnly = codec === "h264" && size === "160x120";
      const raw = join(folder, "encoded.mp4");
      await runMedia("ffmpeg", [
         ...ffmpegBase,
         "-f",
         "lavfi",
         "-i",
         `testsrc2=size=${size}:rate=25:duration=6`,
         "-vf",
         `setsar=${containerOnly ? "0" : sar.replace(":", "/")}`,
         "-c:v",
         encoder,
         "-g",
         "50",
         ...(codec === "hevc" ? ["-x265-params", "pools=2:log-level=error:open-gop=0:keyint=50:min-keyint=50:scenecut=0"] : []),
         raw,
      ]);
      const path = join(folder, "container-only.mp4");
      await runMedia("ffmpeg", [...ffmpegBase, "-i", raw, "-c", "copy", ...(containerOnly ? ["-aspect", sar === "1:1" ? "4:3" : "16:9"] : []), path]);
      const source = await probeSource(path);
      assert.equal(primaryVideo(source)!.sampleAspectRatio, sar);
      // Check that the container-only fixture reproduces the loss in MPEG-TS.
      const transport = join(folder, "without-container.ts");
      await runMedia("ffmpeg", [...ffmpegBase, "-i", path, "-c", "copy", transport]);
      if (containerOnly) assert.equal(primaryVideo(await probeSource(transport))!.sampleAspectRatio, "");
      for (const extension of ["mp4", "mkv"]) {
         const cuts = [];
         for (const [index, start, end] of [
            [0, 0, 4],
            [1, 0, 4.32],
            [2, 0.32, 4.32],
         ] as const) {
            const cut = await analyzeCut(source, { id: String(index), color: 0, start, end });
            assert.equal(cut.method, index === 0 ? "copy" : "boundary");
            const output = join(folder, `trim-${sar.replace(":", "-")}-${index}.${extension}`);
            await rm(output, { force: true });
            await exportCut(source, cut, output);
            assert.equal(primaryVideo(await probeSource(output))!.sampleAspectRatio, sar);
            cuts.push(cut);
         }
         const combined = join(folder, `combined-${sar.replace(":", "-")}.${extension}`);
         await rm(combined, { force: true });
         await exportCombined(source, [cuts[0]!, cuts[2]!], combined, {});
         assert.equal(primaryVideo(await probeSource(combined))!.sampleAspectRatio, sar);
      }
      const distorted = join(folder, "distorted.mp4");
      await runMedia("ffmpeg", [...ffmpegBase, "-i", path, "-c", "copy", "-aspect", "2:1", distorted]);
      await assert.rejects(verifyOutputStructure(source, distorted, [], source.duration), /changed video pixel proportions/);
   }
}
console.log("PASS container-only square and non-square pixel proportions, copied and encoded boundaries, combined exports, and rejection of distorted output");
