import { mkdtemp, rm, writeFile, utimes, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SourceProbe } from "./source-probe";
import { probeSource } from "./media/probe";
import type { ProbedSource } from "./media/probe";

vi.mock("./media/probe", () => ({ probeSource: vi.fn() }));
const folders: string[] = [];
afterEach(async () => {
   vi.resetAllMocks();
   await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function fixture() {
   const folder = await mkdtemp(join(tmpdir(), "attacut-source-probe-"));
   folders.push(folder);
   const path = join(folder, "source.mp4");
   await writeFile(path, "video");
   vi.mocked(probeSource).mockImplementation(
      async (path) =>
         ({
            id: "original",
            url: "media://source/original",
            path,
            streams: [{ index: 0, title: "Original" }],
            chapters: [{ title: "Chapter" }],
         }) as ProbedSource
   );
   return path;
}
it("reopens unchanged sources with independent metadata and a new media identity", async () => {
   const path = await fixture();
   const probe = new SourceProbe();
   const first = await probe.open(path);
   first.streams[0]!.title = "Changed";
   const second = await probe.open(path);
   second.chapters[0]!.title = "Changed";
   const third = await probe.open(path);
   expect(probeSource).toHaveBeenCalledTimes(1);
   expect(second.streams[0]!.title).toBe("Original");
   expect(third.chapters[0]!.title).toBe("Chapter");
   expect(new Set([first.id, second.id, third.id]).size).toBe(3);
   expect(second.url).toBe(`media://source/${second.id}`);
});
it("reprobes changed files even when their size and modified time match", async () => {
   const path = await fixture();
   const probe = new SourceProbe();
   await probe.open(path);
   const before = await stat(path);
   await writeFile(path, "other");
   await utimes(path, before.atime, before.mtime);
   await probe.open(path);
   expect(probeSource).toHaveBeenCalledTimes(2);
   await rm(path);
   await expect(probe.open(path)).rejects.toThrow();
});
it("does not cache failures or files changed during probing", async () => {
   const path = await fixture();
   const probe = new SourceProbe();
   vi.mocked(probeSource).mockRejectedValueOnce(new Error("Invalid video"));
   await expect(probe.open(path)).rejects.toThrow("Invalid video");
   const implementation = vi.mocked(probeSource).getMockImplementation()!;
   vi.mocked(probeSource).mockImplementationOnce(async (...args) => {
      await writeFile(path, "changed during probe");
      return implementation(...args);
   });
   await probe.open(path);
   await probe.open(path);
   expect(probeSource).toHaveBeenCalledTimes(3);
});
it("honors cancellation on cached opens and bounds retained sources", async () => {
   const path = await fixture();
   const probe = new SourceProbe();
   await probe.open(path);
   await expect(probe.open(path, AbortSignal.abort())).rejects.toThrow();
   for (let index = 0; index < 4; index++) {
      const other = `${path}.${index}`;
      await writeFile(other, "video");
      await probe.open(other);
   }
   await probe.open(path);
   expect(probeSource).toHaveBeenCalledTimes(6);
});
it("does not retain a result when its opening was cancelled during probing", async () => {
   const path = await fixture();
   const probe = new SourceProbe();
   const controller = new AbortController();
   const implementation = vi.mocked(probeSource).getMockImplementation()!;
   vi.mocked(probeSource).mockImplementationOnce(async (...args) => {
      const source = await implementation(...args);
      controller.abort();
      return source;
   });
   await expect(probe.open(path, controller.signal)).rejects.toThrow();
   await probe.open(path);
   expect(probeSource).toHaveBeenCalledTimes(2);
});
