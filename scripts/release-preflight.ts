import { readFile } from "node:fs/promises";
import { mediaArchives } from "./media-lock";
import { releaseDownloads } from "./release-downloads";
import { targets } from "./ci-candidate";

// Run before any media downloads or packaging. Publication repeats remote guards.
const pkg = JSON.parse(await readFile("package.json", "utf8")) as { version: string; build: { publish: { owner: string; repo: string }[] } };
const downloads = releaseDownloads(pkg.version);
if (downloads.length !== 8 || new Set(downloads).size !== 8) throw new Error("Release must contain eight distinct app downloads.");
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
