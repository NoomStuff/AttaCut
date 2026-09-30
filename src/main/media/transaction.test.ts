import { expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withTemporaryOutput } from "./transaction";
import { publishOutput, removeTemporary } from "./publish";
import type * as Publish from "./publish";

vi.mock("./publish", async (original) => ({
   ...(await original<typeof Publish>()),
   removeTemporary: vi.fn(async () => {
      throw new Error("Cleanup denied");
   }),
}));

it("reports publication success even when cleanup fails and preserves an earlier work failure", async () => {
   const folder = await mkdtemp(join(tmpdir(), "attacut-transaction-"));
   const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
   try {
      const output = join(folder, "clip.mp4");
      await expect(
         withTemporaryOutput(folder, ".work-", async (temporary) => {
            const file = join(temporary, "verified.mp4");
            await writeFile(file, "verified export");
            await publishOutput(file, output);
            return output;
         })
      ).resolves.toBe(output);
      expect(await readFile(output, "utf8")).toBe("verified export");
      const failure = new Error("Encoding failed");
      await expect(
         withTemporaryOutput(folder, ".work-", async () => {
            throw failure;
         })
      ).rejects.toBe(failure);
      expect(removeTemporary).toHaveBeenCalledTimes(2);
   } finally {
      warning.mockRestore();
      await rm(folder, { recursive: true, force: true });
   }
});
