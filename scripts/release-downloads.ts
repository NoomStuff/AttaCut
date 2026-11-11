import { copyFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";

export const feeds = ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"];
/** The exact sources and recipe of the bundled ffmpeg and ffprobe, built by scripts/build-media.sh. */
export const sourcesPacket = "AttaCut-sources.zip";

function assertVersion(version: string): void {
   if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid release version.");
}

/** Verified build outputs. Mac ZIPs are payload checks only and are not published. */
export function releaseDownloads(version: string): string[] {
   assertVersion(version);
   return [
      "win-x64-Installer.exe",
      "win-x64-Installer.exe.blockmap",
      "win-x64.exe",
      "mac-x64.dmg",
      "mac-x64.zip",
      "mac-arm64.dmg",
      "mac-arm64.zip",
      "linux-x86_64.AppImage",
      "linux-arm64.AppImage",
   ].map((suffix) => `AttaCut-${version}-${suffix}`);
}

/** Build output name to versionless public name, stable for releases/latest/download links. */
export function publishedDownloads(version: string): { source: string; name: string }[] {
   assertVersion(version);
   return [
      ["win-x64-Installer.exe", "windows-x64-setup.exe"],
      ["win-x64-Installer.exe.blockmap", "windows-x64-setup.exe.blockmap"],
      ["win-x64.exe", "windows-x64-portable.exe"],
      ["mac-x64.dmg", "macos-x64.dmg"],
      ["mac-arm64.dmg", "macos-arm64.dmg"],
      ["linux-x86_64.AppImage", "linux-x64.AppImage"],
      ["linux-arm64.AppImage", "linux-arm64.AppImage"],
   ].map(([source, name]) => ({ source: `AttaCut-${version}-${source}`, name: `AttaCut-${name}` }));
}

export function publishedName(version: string, source: string): string {
   const file = publishedDownloads(version).find((entry) => entry.source === source);
   if (!file) throw new Error(`Not a published app download: ${source}`);
   return file.name;
}

/** Everything the release page carries: app downloads, updater feeds and the corresponding sources. */
export function publishedAssets(version: string): string[] {
   return [...publishedDownloads(version).map((file) => file.name), ...feeds, sourcesPacket];
}

export async function selectReleaseDownloads(source: string, feedDirectory: string, destination: string, version: string): Promise<void> {
   if (resolve(source) === resolve(destination)) throw new Error("Use a separate empty download destination.");
   await mkdir(destination, { recursive: true });
   if ((await readdir(destination)).length) throw new Error("Download destination must be empty.");
   const expected = releaseDownloads(version);
   const entries = await readdir(source);
   const selected = entries.filter((name) => name !== sourcesPacket && /\.(exe|zip|dmg|AppImage|blockmap)$/i.test(name));
   if (selected.length !== expected.length || selected.some((name) => !expected.includes(name)) || expected.some((name) => !selected.includes(name)))
      throw new Error("Expected exactly the verified build outputs for this version.");
   const files = [
      ...publishedDownloads(version).map((file) => ({ from: join(source, file.source), name: file.name })),
      ...feeds.map((name) => ({ from: join(feedDirectory, name), name })),
      { from: join(source, sourcesPacket), name: sourcesPacket },
   ];
   for (const file of files) {
      const info = await lstat(file.from);
      if (!info.isFile() || info.size === 0) throw new Error(`Invalid release file: ${file.name}`);
   }
   for (const file of files) await copyFile(file.from, join(destination, file.name));
}

if (import.meta.main) {
   const [source, feedDirectory, destination, tag, ...extra] = process.argv.slice(2);
   if (!source || !feedDirectory || !destination || !tag?.startsWith("v") || extra.length)
      throw new Error("Usage: release-downloads.ts <source> <feed directory> <empty destination> <tag>");
   await selectReleaseDownloads(source, feedDirectory, destination, tag.slice(1));
}
