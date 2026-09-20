import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, appendFile, readdir, chmod } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { mediaArchives } from "./media-lock.ts";

const archives = mediaArchives[`${process.platform}-${process.arch}`];
if (!archives) throw new Error("No pinned media build for this platform.");
await mkdir("work", { recursive: true });
const folder = await mkdtemp(resolve("work/media-toolchain-"));
for (const archive of archives) {
   const response = await fetch(archive.url);
   if (!response.ok) throw new Error(`Media download failed: ${response.status} ${archive.url}`);
   const data = Buffer.from(await response.arrayBuffer());
   if (createHash("sha256").update(data).digest("hex") !== archive.sha256) throw new Error(`Media checksum mismatch: ${archive.url}`);
   const path = join(folder, basename(new URL(archive.url).pathname));
   await writeFile(path, data);
   execFileSync("tar", ["-xf", path, "-C", folder], { stdio: "inherit" });
}
const files = await readdir(folder, { recursive: true });
for (const name of ["ffmpeg", "ffprobe"] as const) {
   const filename = `${name}${process.platform === "win32" ? ".exe" : ""}`;
   const match = files.find((path) => basename(path) === filename && !path.includes("__MACOSX"));
   if (!match) throw new Error(`${filename} is missing from the pinned archives.`);
   const path = join(folder, match);
   if (process.platform !== "win32") await chmod(path, 0o755);
   execFileSync(path, ["-version"], { stdio: "ignore" });
   const variable = name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
   if (process.env["GITHUB_ENV"]) await appendFile(process.env["GITHUB_ENV"], `${variable}=${path}\n`);
   console.log(`${variable}=${path}`);
}
