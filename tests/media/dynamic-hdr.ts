import assert from "node:assert/strict";
import { mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { probeSource } from "../../src/main/media/probe";
import { analyzeCut } from "../../src/main/media/cut";
import { ExportService } from "../../src/main/exports";

const directory = resolve("work/dynamic-hdr");
await mkdir(directory, { recursive: true });
// Checked-in synthetic HDR10+ avoids depending on optional x265 HDR10+ encoding support.
const path = resolve("tests/media/fixtures/hdr10plus.mp4");
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
