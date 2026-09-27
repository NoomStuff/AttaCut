import { YAML } from "bun";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import process from "node:process";

const [dist, output, tag] = process.argv.slice(2);
if (!dist || !output || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag ?? "")) {
   throw new Error("Usage: bun scripts/prepare-update-feed.mjs <dist> <output> <vX.Y.Z>");
}

const channels = ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"];
const version = tag.slice(1);
await mkdir(output, { recursive: true });
for (const channel of channels) {
   const source = await readFile(join(dist, channel), "utf8");
   const info = YAML.parse(source);
   if (info?.version !== version || !Array.isArray(info.files) || info.files.length !== 1) {
      throw new Error(`${channel} does not describe ${tag} with exactly one app package.`);
   }
   const file = info.files[0];
   const name = file?.url;
   const extension = channel === "latest.yml" ? "-Installer.exe" : ".AppImage";
   if (typeof name !== "string" || basename(name) !== name || !name.startsWith(`AttaCut-${version}-`) || !name.endsWith(extension)) {
      throw new Error(`${channel} has an unexpected package name.`);
   }
   if (typeof file.sha512 !== "string" || !file.sha512 || !(await stat(join(dist, name))).isFile()) {
      throw new Error(`${channel} has no matching package or checksum.`);
   }
   const url = `https://github.com/NoomStuff/AttaCut/releases/download/${tag}/${encodeURIComponent(name)}`;
   const fileLine = `url: ${name}`;
   if (!source.includes(fileLine)) throw new Error(`${channel} has an unexpected file URL format.`);
   let feed = source.replace(fileLine, `url: ${url}`);
   if (info.path) {
      const pathLine = `path: ${name}`;
      if (info.path !== name || !feed.includes(pathLine)) throw new Error(`${channel} has an unexpected legacy path.`);
      feed = feed.replace(pathLine, `path: ${url}`);
   }
   await writeFile(join(output, channel), feed);
}
