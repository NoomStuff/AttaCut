import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ffmpegBase, runMedia } from "../../src/main/media/process.ts";
import { probeSource } from "../../src/main/media/probe.ts";
import { ExportService } from "../../src/main/exports.ts";
import { extractScrubPcm } from "../../src/main/media/scrub-audio.ts";

const directory = await mkdtemp(resolve("work/architecture-test-"));
const path = join(directory, "two-video.mkv");
await runMedia("ffmpeg", [...ffmpegBase, "-i", resolve("work/fixture.mp4"), "-map", "0:v:0", "-map", "0:v:0", "-map", "0:a:0", "-t", "2", "-c", "copy", path]);
const source = await probeSource(path);
const service = new ExportService(() => {});
const plan = await service.plan(source, {
   sourceId: source.id,
   directory,
   audioTracks: [],
   items: [{ name: "muted", clip: { id: "x", color: 0, start: 0, end: source.duration } }],
});
service.start(plan.id);
await service.waitForIdle();
assert.equal(service.current?.items[0]?.status, "completed", service.current?.items[0]?.error ?? "");
const output = await probeSource(plan.items[0]!.outputPath);
assert.deepEqual(
   output.streams.map((stream) => stream.type),
   ["video", "video"]
);
// Selecting one audio track forces a full-source TS remux to MKV. The plan says
// its data track is omitted, and the mux must follow that plan instead of failing.
const dataPath = join(directory, "telemetry.bin");
await writeFile(dataPath, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
const transportPath = join(directory, "telemetry.ts");
await runMedia("ffmpeg", [
   ...ffmpegBase,
   "-i",
   resolve("work/fixture.mp4"),
   "-f",
   "data",
   "-i",
   dataPath,
   "-map",
   "0:v:0",
   "-map",
   "0:a",
   "-map",
   "1:0",
   "-t",
   "2",
   "-c",
   "copy",
   transportPath,
]);
const transport = await probeSource(transportPath);
assert.ok(transport.streams.some((stream) => stream.type === "data"));
const selectedTrack = transport.streams.find((stream) => stream.type === "audio")!.index;
const telemetryPlan = await service.plan(transport, {
   sourceId: transport.id,
   directory,
   audioTracks: [selectedTrack],
   items: [{ name: "without-telemetry", clip: { id: "t", color: 0, start: 0, end: transport.duration } }],
});
assert.match(telemetryPlan.items[0]!.message, /telemetry tracks/);
service.start(telemetryPlan.id);
await service.waitForIdle();
assert.equal(service.current?.items[0]?.status, "completed", service.current?.items[0]?.error ?? "");
const telemetryOutput = await probeSource(telemetryPlan.items[0]!.outputPath);
assert.equal(telemetryOutput.streams.filter((stream) => stream.type === "audio").length, 1);
assert.equal(telemetryOutput.streams.filter((stream) => stream.type === "data").length, 0);
// MP4 can carry gpmd telemetry. Check the payload bytes, not just the stream count.
const gpmdPath = join(directory, "gpmd.mp4");
await runMedia("ffmpeg", [...ffmpegBase, "-i", transportPath, "-map", "0", "-c", "copy", "-tag:d:0", "gpmd", gpmdPath]);
const gpmd = await probeSource(gpmdPath);
const gpmdPlan = await service.plan(gpmd, {
   sourceId: gpmd.id,
   directory,
   items: [{ name: "gpmd-cut", clip: { id: "g", color: 0, start: 0, end: Math.min(1.5, gpmd.duration - 0.1) } }],
});
service.start(gpmdPlan.id);
await service.waitForIdle();
assert.equal(service.current?.items[0]?.status, "completed", service.current?.items[0]?.error ?? "");
const sourceData = join(directory, "gpmd-source.bin");
const outputData = join(directory, "gpmd-output.bin");
for (const [input, extracted] of [
   [gpmdPath, sourceData],
   [gpmdPlan.items[0]!.outputPath, outputData],
])
   await runMedia("ffmpeg", [...ffmpegBase, "-i", input!, "-map", "0:d:0", "-c", "copy", "-f", "data", extracted!]);
assert.deepEqual(await readFile(outputData), await readFile(sourceData));
const partial = await service.plan(source, { sourceId: source.id, directory, items: [{ name: "partial", clip: { id: "y", color: 0, start: 0.5, end: 1.5 } }] });
assert.equal(partial.items[0]!.method, "unsupported");
const audio = await extractScrubPcm({ ...source, duration: 10 * 60 * 60 }, [source.streams.find((stream) => stream.type === "audio")!.index]);
assert.ok(audio && audio.pcm.byteLength <= 22050 * 2 * 30 + 4096);
const longerPath = join(directory, "longer.mp4");
await runMedia("ffmpeg", [...ffmpegBase, "-stream_loop", "1", "-i", resolve("work/fixture.mp4"), "-t", "36", "-c", "copy", longerPath]);
const longer = await probeSource(longerPath);
const track = longer.streams.find((stream) => stream.type === "audio")!.index;
const first = await extractScrubPcm(longer, [track]);
const second = await extractScrubPcm(longer, [track], undefined, 30);
assert.ok(first && first.pcm.byteLength <= 22050 * 2 * 30 + 4096);
assert.ok(second && second.start === 30 && second.pcm.byteLength > 22050 * 2);
console.log("PASS whole-source multi-video preservation and bounded scrub extraction");
