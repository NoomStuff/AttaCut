import { copyFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";

export function releaseDownloads(version: string): string[] {
   if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid release version.");
   return [
      "win-x64-Installer.exe",
      "win-x64.exe",
      "mac-x64.dmg",
      "mac-x64.zip",
      "mac-arm64.dmg",
      "mac-arm64.zip",
      "linux-x86_64.AppImage",
      "linux-arm64.AppImage",
   ].map((suffix) => `AttaCut-${version}-${suffix}`);
}

export async function selectReleaseDownloads(source: string, destination: string, version: string): Promise<void> {
   if (resolve(source) === resolve(destination)) throw new Error("Use a separate empty download destination.");
   await mkdir(destination, { recursive: true });
   if ((await readdir(destination)).length) throw new Error("Download destination must be empty.");
   const expected = releaseDownloads(version);
   const entries = await readdir(source);
   const selected = entries.filter((name) => /\.(exe|zip|dmg|AppImage)$/i.test(name));
   if (selected.length !== expected.length || selected.some((name) => !expected.includes(name)) || expected.some((name) => !selected.includes(name)))
      throw new Error("Expected exactly the eight release downloads for this version.");
   for (const name of expected) {
      const info = await lstat(join(source, name));
      if (!info.isFile() || info.size === 0) throw new Error(`Invalid release download: ${name}`);
   }
   for (const name of expected) await copyFile(join(source, name), join(destination, name));
}

if (import.meta.main) {
   const [source, destination, tag, ...extra] = process.argv.slice(2);
   if (!source || !destination || !tag?.startsWith("v") || extra.length) throw new Error("Usage: release-downloads.ts <source> <empty destination> <tag>");
   await selectReleaseDownloads(source, destination, tag.slice(1));
}
