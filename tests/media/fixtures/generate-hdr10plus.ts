import assert from "node:assert/strict";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ffmpegBase, runMedia } from "../../../src/main/media/process";
import { probeSource } from "../../../src/main/media/probe";

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
const path = join(directory, "generated.mp4");
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
assert.equal((await probeSource(path)).streams[0]!.dynamicHdr, true, "This encoder must support real HDR10+ metadata");
await copyFile(path, resolve("tests/media/fixtures/hdr10plus.mp4"));
console.log("Regenerated synthetic HDR10+ fixture.");
