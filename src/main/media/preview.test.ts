import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leasePreview, prunePreviews, releasePreview } from "./preview";

describe("preview cache budget", () => {
   it("keeps a leased file and evicts unused files that exceed the aggregate budget", async () => {
      const folder = await mkdtemp(join(tmpdir(), "attacut-preview-budget-"));
      const active = join(folder, "active.mp4");
      const unused = join(folder, "unused.mp4");
      try {
         for (const path of [active, unused]) {
            await writeFile(path, Buffer.alloc(3 * 1024));
         }
         leasePreview(active);
         await prunePreviews(folder, 2, false, 4 * 1024);
         expect((await stat(active)).size).toBe(3 * 1024);
         await expect(stat(unused)).rejects.toMatchObject({ code: "ENOENT" });
         releasePreview(active);
         await prunePreviews(folder, 0, false);
         await expect(stat(active)).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
         releasePreview(active);
         await rm(folder, { recursive: true, force: true });
      }
   });
});
