import assert from "node:assert/strict";
import { mkdir, writeFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ffmpegBase, runMedia } from "../../src/main/media/process";
import { probeSource } from "../../src/main/media/probe";
import { analyzeCut } from "../../src/main/media/cut";
import { ExportService } from "../../src/main/exports";

const directory = resolve("work/dynamic-hdr");
await mkdir(directory, { recursive: true });
// Synthetic HDR10+ metadata in the x265 dhdr10-info schema. Every encoded frame carries it.
const json = join(directory, "metadata.json");
await writeFile(
   json,
   JSON.stringify({
      JSONInfo: { HDR10plusProfile: "B", Version: "1.0" },
      SceneInfo: Array.from({ length: 96 }, (_, index) => ({
         BezierCurveData: { Anchors: [100, 250, 400, 550, 700, 850, 900, 940, 970], KneePointX: 200, KneePointY: 300 },
         LuminanceParameters: {
            AverageRGB: 200,
            MaxScl: [8000, 7000, 6000],
            LuminanceDistributions: { DistributionIndex: [1, 5, 10, 25, 50, 75, 90, 95, 99], DistributionValues: [0, 10, 20, 50, 100, 300, 1000, 3000, 6000] },
         },
         NumberOfWindows: 1,
         TargetedSystemDisplayMaximumLuminance: 400,
         SceneFrameIndex: index,
         SceneId: 0,
         SequenceFrameIndex: index,
      })),
      SceneInfoSummary: { SceneFirstFrameIndex: [0], SceneFrameNumbers: [96] },
   })
);
const path = join(directory, "hdr10plus.mp4");
// Use a relative path so Windows drive-colon parsing cannot split x265 parameters.
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-f",
   "lavfi",
   "-i",
   "testsrc2=size=64x64:rate=24:duration=4",
   "-pix_fmt",
   "yuv420p10le",
   "-color_trc",
   "smpte2084",
   "-color_primaries",
   "bt2020",
   "-colorspace",
   "bt2020nc",
   "-c:v",
   "libx265",
   "-preset",
   "ultrafast",
   "-x265-params",
   "log-level=error:pools=1:keyint=48:min-keyint=48:scenecut=0:dhdr10-info=work/dynamic-hdr/metadata.json",
   path,
]);
const source = await probeSource(path);
assert.equal(source.streams[0]!.dynamicHdr, true, "real decoded frames expose HDR10+ side data");
const clip = { id: "hdr", color: 0, start: 0.3, end: 3.7 };
const analysis = await analyzeCut(source, clip);
assert.equal(analysis.method, "unsupported");
assert.match(analysis.message, /dynamic HDR/);
const service = new ExportService(() => {});
const plan = await service.plan(source, { sourceId: source.id, directory, items: [{ name: "must-not-exist", clip }] });
assert.throws(() => service.start(plan.id), /cannot be exported/);
assert.ok(!(await readdir(directory)).includes("must-not-exist.mp4"));
console.log("PASS real HDR10+ refuses boundary encoding without losing metadata");
