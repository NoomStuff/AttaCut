import { mkdtemp, mkdir, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { feeds, publishedAssets, releaseDownloads, selectReleaseDownloads } from "./release-downloads";

it.each(["valid", "missing", "unexpected", "old version", "occupied", "missing feed"])("selects exact release downloads: %s", async (scenario) => {
   const root = await mkdtemp(join(tmpdir(), "attacut-downloads-"));
   try {
      const source = join(root, "source");
      const feed = join(root, "feed");
      const output = join(root, "output");
      await mkdir(source);
      await mkdir(feed);
      const expected = releaseDownloads("0.25.0");
      for (const name of expected.slice(scenario === "missing" ? 1 : 0)) await writeFile(join(source, name), name);
      for (const name of feeds.slice(scenario === "missing feed" ? 1 : 0)) await writeFile(join(feed, name), "feed");
      if (scenario === "unexpected" || scenario === "old version")
         await writeFile(join(source, scenario === "unexpected" ? "extra.exe" : "AttaCut-0.24.0-win-x64.exe"), "other");
      if (scenario === "occupied") {
         await mkdir(output);
         await writeFile(join(output, "stale.exe"), "old");
      }
      const pending = selectReleaseDownloads(source, feed, output, "0.25.0");
      if (scenario === "valid") {
         await pending;
         const published = (await readdir(output)).sort();
         expect(published).toEqual(publishedAssets("0.25.0").sort());
         expect(published.some((name) => name.includes("0.25.0") || name.endsWith(".zip"))).toBe(false);
         expect(await readFile(join(output, "AttaCut-windows-x64-setup.exe"), "utf8")).toBe("AttaCut-0.25.0-win-x64-Installer.exe");
      } else await expect(pending).rejects.toThrow();
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});
