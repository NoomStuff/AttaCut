import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { releaseDownloads, selectReleaseDownloads } from "./release-downloads";

it.each(["valid", "missing", "unexpected", "old version", "occupied"])("selects exact release downloads: %s", async (scenario) => {
   const root = await mkdtemp(join(tmpdir(), "attacut-downloads-"));
   try {
      const source = join(root, "source");
      const output = join(root, "output");
      await mkdir(source);
      const expected = releaseDownloads("0.25.0");
      for (const name of expected.slice(scenario === "missing" ? 1 : 0)) await writeFile(join(source, name), "app");
      if (scenario === "unexpected" || scenario === "old version")
         await writeFile(join(source, scenario === "unexpected" ? "extra.exe" : "AttaCut-0.24.0-win-x64.exe"), "other");
      if (scenario === "occupied") {
         await mkdir(output);
         await writeFile(join(output, "stale.exe"), "old");
      }
      const pending = selectReleaseDownloads(source, output, "0.25.0");
      if (scenario === "valid") {
         await pending;
         expect((await readdir(output)).sort()).toEqual(expected.sort());
      } else await expect(pending).rejects.toThrow();
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});
