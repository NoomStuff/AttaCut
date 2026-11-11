import { readFile } from "node:fs/promises";
import { mediaArchives } from "./media-lock";
import { publishedAssets } from "./release-downloads";
import { targets } from "./ci-candidate";

// Run before any media downloads or packaging. Publication repeats remote guards.
const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string; build: { publish: { owner: string; repo: string }[] } };
const assets = publishedAssets(pkg.version);
if (new Set(assets).size !== assets.length) throw new Error("Release files must have distinct names.");
if (pkg.build.publish.length !== 1 || pkg.build.publish[0]?.owner !== "NoomStuff" || pkg.build.publish[0]?.repo !== "AttaCut")
   throw new Error("Unexpected release destination.");
for (const target of targets) {
   const platform = target.replace("win-", "win32-").replace("mac-", "darwin-");
   const archives = mediaArchives[platform];
   if (!archives?.length) throw new Error(`Missing pinned source inputs: ${target}`);
   for (const archive of archives) {
      if (!archive.url.startsWith("https://") || !/^[a-f0-9]{64}$/.test(archive.sha256)) throw new Error(`Unpinned media input: ${target}`);
   }
}
console.log(`Release preflight passed for ${pkg.version} and ${targets.length} targets.`);
