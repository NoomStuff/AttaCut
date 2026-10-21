import { YAML } from "bun";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import process from "node:process";

const [dist, output, tag] = process.argv.slice(2);
if (!dist || !output || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
   throw new Error("Usage: bun scripts/prepare-update-feed.mjs <dist> <output> <vX.Y.Z>");
}

const channels = [
   ["latest.yml", "win-x64-Installer.exe"],
   ["latest-linux.yml", "linux-x86_64.AppImage"],
   ["latest-linux-arm64.yml", "linux-arm64.AppImage"],
];
const version = tag.slice(1);
await mkdir(output, { recursive: true });
const feeds = [];
for (const [channel, suffix] of channels) {
   const info = YAML.parse(await readFile(join(dist, channel), "utf8"));
   if (
      !info ||
      typeof info !== "object" ||
      Object.keys(info).some((key) => !["version", "files", "path", "sha512", "releaseDate", "releaseName", "releaseNotes"].includes(key)) ||
      info.version !== version ||
      !Array.isArray(info.files) ||
      info.files.length !== 1
   ) {
      throw new Error(`${channel} does not describe ${tag} with exactly one app package.`);
   }
   const file = info.files[0];
   const name = file?.url;
   if (typeof name !== "string" || basename(name) !== name || name !== `AttaCut-${version}-${suffix}`) {
      throw new Error(`${channel} has an unexpected package name.`);
   }
   if (
      Object.keys(file).some((key) => !["url", "sha512", "size", "blockMapSize"].includes(key)) ||
      typeof file.sha512 !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512) ||
      !Number.isSafeInteger(file.size) ||
      file.size <= 0
   ) {
      throw new Error(`${channel} has no matching package or checksum.`);
   }
   if (file.blockMapSize !== undefined && (!Number.isSafeInteger(file.blockMapSize) || file.blockMapSize <= 0 || file.blockMapSize >= file.size)) {
      throw new Error(`${channel} has an invalid embedded block map size.`);
   }
   const packagePath = join(dist, name);
   const metadata = await stat(packagePath);
   if (!metadata.isFile() || metadata.size !== file.size) throw new Error(`${channel} package size does not match.`);
   const hash = createHash("sha512");
   for await (const chunk of createReadStream(packagePath)) hash.update(chunk);
   if (hash.digest("base64") !== file.sha512 || (info.sha512 !== undefined && info.sha512 !== file.sha512))
      throw new Error(`${channel} checksum does not match package bytes.`);
   const url = `https://github.com/NoomStuff/AttaCut/releases/download/${tag}/${encodeURIComponent(name)}`;
   if (info.path !== undefined) {
      if (info.path !== name) throw new Error(`${channel} has an unexpected legacy path.`);
      info.path = url;
   }
   for (const field of ["releaseDate", "releaseName", "releaseNotes"]) {
      if (info[field] !== undefined && typeof info[field] !== "string") throw new Error(`${channel} has invalid ${field}.`);
   }
   file.url = url;
   feeds.push([channel, YAML.stringify(info)]);
}
for (const [channel, feed] of feeds) await writeFile(join(output, channel), feed);
