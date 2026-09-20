import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { ExportService } from "../../src/main/exports.ts";
import { probeSource } from "../../src/main/media/probe.ts";
import { preparePreview } from "../../src/main/media/preview.ts";

const source = await probeSource(resolve("work/fixture.mp4"));
const directory = await mkdtemp(resolve("work/job-test-"));
const service = new ExportService(() => {});
const plan = await service.plan(source, {
   sourceId: source.id,
   directory,
   items: [
      { name: "first", clip: { id: "one", color: 0, start: 1.3, end: 14.7 } },
      { name: "second", clip: { id: "two", color: 1, start: 3.1, end: 6.3 } },
   ],
});
const job = service.start(plan.id);
setTimeout(() => service.cancel(), 150);
await service.waitForIdle();
assert.ok(service.current!.items.every((item) => item.status === "cancelled"));
assert.deepEqual(await readdir(directory), [], "Cancellation removes unfinished files");
// A file appearing after planning must survive the attempted export.
await writeFile(plan.items[0]!.outputPath, "existing file");
service.retry(job.id);
await service.waitForIdle();
assert.equal(service.current!.items[0]!.status, "failed");
assert.equal(service.current!.items[1]!.status, "completed");
assert.equal(await readFile(plan.items[0]!.outputPath, "utf8"), "existing file");
const finalNames = await readdir(directory);
assert.equal(finalNames.length, 2);
assert.ok(!finalNames.some((name) => name.startsWith(".attacut-")));
const previewFolder = join(directory, "previews");
const controller = new AbortController();
const audioIndices = source.streams.filter((stream) => stream.type === "audio").map((stream) => stream.index);
const preview = preparePreview(source, previewFolder, audioIndices, true, { signal: controller.signal });
setTimeout(() => controller.abort(), 100);
await assert.rejects(preview);
assert.deepEqual(await readdir(previewFolder), [], "Cancelled preview removes its temporary files");
const ready = await preparePreview(source, previewFolder, [2], true, {});
const playable = await probeSource(ready.path);
assert.equal(playable.streams.filter((stream) => stream.type === "audio").length, 1);
assert.notEqual((await preparePreview(source, previewFolder, [1], true, {})).path, ready.path, "Each preview keeps its chosen audio");
const mixed = await preparePreview(source, previewFolder, audioIndices, true, {});
assert.equal((await probeSource(mixed.path)).streams.filter((stream) => stream.type === "audio").length, 1, "Selected tracks are mixed for playback");
assert.notEqual(mixed.path, ready.path);
assert.equal(playable.streams[0]!.codec, "h264");
console.log("Jobs passed: cancel, cleanup, retry, collision after planning, preserving completed files, and mixed-track proxy preview.");
