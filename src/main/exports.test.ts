import { afterEach, describe, expect, it, vi } from "vitest";
import { link, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { ExportService, sanitizeName } from "./exports";
import { publishOutput } from "./media/publish";
import type { ProbedSource } from "./media/probe";
import type { Clip } from "../shared/types";

vi.mock("./media/cut.ts", () => ({
   analyzeCut: async (_source: unknown, clip: Clip) => ({ clip, method: "copy", encodedSeconds: 0, message: "", spans: [] }),
   exportCut: async (source: ProbedSource, _analysis: unknown, destination: string, options: { overwrite: boolean }) => {
      const temporary = `${destination}.tmp`;
      await writeFile(temporary, "new export");
      await publishOutput(temporary, destination, options.overwrite, source.path);
   },
}));

const folders: string[] = [];
afterEach(async () => {
   for (const folder of folders.splice(0)) {
      if (dirname(folder) !== resolve(tmpdir())) throw new Error("Unexpected test folder.");
      await rm(folder, { recursive: true, force: true });
   }
});
async function fixture() {
   const directory = await mkdtemp(join(tmpdir(), "attacut-export-test-"));
   folders.push(directory);
   const path = join(directory, "source.mp4");
   await writeFile(path, "original");
   const source = { id: "source", path, extension: ".mp4", exportExtension: ".mp4", duration: 10, streams: [] } as unknown as ProbedSource;
   const request = { sourceId: source.id, directory, items: [{ name: "clip", clip: { id: "a", color: 0, start: 0, end: 10 } }] };
   return { directory, source, request, service: new ExportService(() => {}) };
}

describe("export destination confirmation", () => {
   it("plans a missing folder without creating it and requires approval", async () => {
      const { directory, source, request, service } = await fixture();
      request.directory = join(directory, "missing", "nested");
      const plan = await service.plan(source, request);
      expect(plan.directoryMissing).toBe(true);
      await expect(stat(request.directory)).rejects.toMatchObject({ code: "ENOENT" });
      expect(() => service.start(plan.id)).toThrow("Confirm creating");
      service.start(plan.id, { createDirectory: true });
      await service.waitForIdle();
      expect(service.current?.items[0]?.status).toBe("completed");
   });
   it("keeps the requested filename and existing content until replacement is approved", async () => {
      const { directory, source, request, service } = await fixture();
      const output = join(directory, "clip.mp4");
      await writeFile(output, "old export");
      const plan = await service.plan(source, request);
      expect(plan.existingPaths).toEqual([output]);
      expect(plan.items[0]?.outputPath).toBe(output);
      expect(() => service.start(plan.id)).toThrow("Confirm replacing");
      expect(await readFile(output, "utf8")).toBe("old export");
      service.start(plan.id, { overwrite: true });
      await service.waitForIdle();
      expect(await readFile(output, "utf8")).toBe("new export");
      expect(await readFile(source.path, "utf8")).toBe("original");
   });
   it("does not replace a file that appeared after planning", async () => {
      const { source, request, service } = await fixture();
      const plan = await service.plan(source, request);
      const output = plan.items[0]!.outputPath;
      await writeFile(output, "arrived later");
      service.start(plan.id, { overwrite: true });
      await service.waitForIdle();
      expect(service.current?.items[0]?.status).toBe("failed");
      expect(await readFile(output, "utf8")).toBe("arrived later");
   });
   it("rejects source filenames and hard links to the source", async () => {
      const { directory, source, request, service } = await fixture();
      await expect(service.plan(source, { ...request, mode: "combined", name: "source" })).rejects.toThrow("original video cannot be replaced");
      await link(source.path, join(directory, "clip.mp4"));
      await expect(service.plan(source, request)).rejects.toThrow("original video cannot be replaced");
   });
   it("preserves an existing file when publishing fails", async () => {
      const { directory, source } = await fixture();
      const output = join(directory, "clip.mp4");
      await writeFile(output, "old export");
      await expect(publishOutput(join(directory, "missing.tmp"), output, true, source.path)).rejects.toThrow();
      expect(await readFile(output, "utf8")).toBe("old export");
   });
});
describe("output filenames", () => {
   it("removes filesystem syntax and reserved Windows device names", () => {
      expect(sanitizeName("a:b?c")).toBe("a_b_c");
      expect(sanitizeName("CON")).toBe("clip-CON");
      expect(sanitizeName("clip. ")).toBe("clip");
      expect(sanitizeName("..")).toBe("clip-untitled");
   });
});
