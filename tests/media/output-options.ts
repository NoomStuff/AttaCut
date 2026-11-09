import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { ExportService } from "../../src/main/exports.ts";
import type { PlanRequest } from "../../src/shared/types.ts";
import { probeSource, sourceKeyframes } from "../../src/main/media/probe.ts";
import type { ProbedSource } from "../../src/main/media/probe.ts";
import { runMedia } from "../../src/main/media/process.ts";
import { verifyLosslessPackets } from "../../src/main/media/verify.ts";

// Export options from the export panel's Format field and Advanced section, on real media.
const directory = await mkdtemp(resolve("work/output-options-"));
const service = new ExportService(() => {});
type Request = Omit<PlanRequest, "sourceId" | "directory">;
async function exported(source: ProbedSource, request: Request): Promise<string[]> {
   const plan = await service.plan(source, { ...request, sourceId: source.id, directory });
   const unsupported = plan.items.find((item) => item.method === "unsupported");
   assert.equal(unsupported, undefined, unsupported?.message ?? "");
   service.start(plan.id, { overwrite: true, mediaChanges: true, substantialEncoding: true });
   await service.waitForIdle();
   for (const item of service.current!.items) assert.equal(item.status, "completed", item.error ?? "");
   return plan.items.map((item) => item.outputPath);
}
const clip = (id: string, start: number, end: number) => ({ name: id, clip: { id, color: 0, start, end } });

const tracks = await probeSource(resolve("work/details/multiple-tracks.mkv"));
const attachment = tracks.streams.find((stream) => stream.type === "attachment")!.index;
const subtitle = tracks.streams.find((stream) => stream.type === "subtitle")!.index;

// A container that cannot hold a track names it instead of dropping it.
const refused = await service.inspect(tracks, { sourceId: tracks.id, items: [clip("mp4", 1.25, 8.75)], container: ".mp4" });
assert.equal(refused[0]!.method, "unsupported");
assert.match(refused[0]!.message, /MP4 cannot store attachments/);
for (const [start, end] of [
   [1.25, 8.75],
   [0, tracks.duration],
] as const) {
   const [path] = await exported(tracks, { items: [clip(`to-mp4-${start}`, start, end)], container: ".mp4", excludedStreams: [attachment] });
   assert.ok(path!.endsWith(".mp4"));
   const output = await probeSource(path!);
   assert.deepEqual(
      output.streams.filter((stream) => !stream.chapterTrack).map((stream) => stream.type),
      ["video", "audio", "audio", "audio", "audio", "subtitle"]
   );
   assert.equal(output.streams.find((stream) => stream.type === "subtitle")!.codec, "mov_text");
}
console.log("PASS another container converts subtitles, refuses attachments and leaves out turned off tracks");

const [withoutSubtitles] = await exported(tracks, { items: [clip("no-subtitles", 1.25, 8.75)], excludedStreams: [subtitle, attachment] });
assert.deepEqual(
   (await probeSource(withoutSubtitles!)).streams.map((stream) => stream.type),
   ["video", "audio", "audio", "audio", "audio"]
);
console.log("PASS turned off subtitle and attachment tracks are left out and verified as absent");

const fixture = await probeSource(resolve("work/fixture.mp4"));
const chapterTitles = async (path: string) =>
   (JSON.parse(await runMedia("ffprobe", ["-v", "error", "-show_chapters", "-of", "json", path])) as { chapters: { tags: { title: string } }[] }).chapters.map(
      (chapter) => chapter.tags.title
   );
const [chaptered] = await exported(fixture, {
   mode: "combined",
   name: "chaptered",
   clipChapters: true,
   items: [clip("Clip 1", 1, 3), clip("Clip 2", 3, 6), clip("Clip 3", 9, 12)],
});
assert.deepEqual(await chapterTitles(chaptered!), ["Clip 1", "Clip 2", "Clip 3"]);
const [wholeChaptered] = await exported(fixture, {
   mode: "combined",
   name: "whole-chaptered",
   clipChapters: true,
   items: [clip("Clip 1", 0, 6), clip("Clip 2", 6, fixture.duration)],
});
assert.deepEqual(await chapterTitles(wholeChaptered!), ["Clip 1", "Clip 2"]);
console.log("PASS combined exports can carry one chapter per clip, including adjacent clips joined into one cut");

// Force lossless never encodes, moves cuts to copyable points and proves every packet is the source's.
const keyframes = await sourceKeyframes(fixture);
const [report] = await service.inspect(fixture, { sourceId: fixture.id, items: [clip("lossless", 1.3, 7.7)], lossless: true });
assert.equal(report!.encodedSeconds, 0);
assert.equal(report!.method, "copy");
assert.ok(
   keyframes.some((time) => Math.abs(time - report!.clip.start) < 0.0005),
   "A lossless cut starts on a keyframe"
);
await exported(fixture, { items: [clip("lossless-separate", 1.3, 7.7)], lossless: true });
await exported(fixture, { mode: "combined", name: "lossless-combined", items: [clip("a", 1.3, 4.2), clip("b", 9.4, 15.1)], lossless: true });
for (const [input, container] of [
   ["work/formats/transport.ts", ".mp4"],
   ["work/formats/hevc-open-gop.mp4", ".mkv"],
   ["work/formats/mpeg4.avi", "auto"],
   ["work/formats/av1.mp4", ".mkv"],
   ["work/formats/vp9.webm", ".mp4"],
] as const) {
   const media = await probeSource(resolve(input));
   await exported(media, { items: [clip(`lossless-${media.name}`, 1.25, Math.min(media.duration, 8.75))], lossless: true, container });
}
await exported(tracks, { mode: "combined", name: "lossless-tracks", items: [clip("a", 1.25, 4), clip("b", 6, 8.75)], lossless: true });
console.log("PASS force lossless copies H.264, HEVC open GOPs, MPEG-4, AV1, VP9 and lossless audio across containers");

const [converted] = await service.inspect(tracks, {
   sourceId: tracks.id,
   items: [clip("lossless-mp4", 1.25, 8.75)],
   lossless: true,
   container: ".mp4",
   excludedStreams: [attachment],
});
assert.equal(converted!.method, "unsupported");
assert.match(converted!.message, /subtitles converted/);
const [boundary] = await exported(fixture, { items: [clip("boundary-encoded", 1.3, 7.7)] });
await assert.rejects(
   verifyLosslessPackets(
      fixture,
      await probeSource(boundary!),
      [{ start: 1.3, end: 7.7 }],
      fixture.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index)
   ),
   /not fully lossless/
);
console.log("PASS force lossless refuses subtitle conversion and rejects an output with re-encoded frames");
