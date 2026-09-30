import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function fileHash(path: string): Promise<string> {
   const hash = createHash("sha256");
   for await (const chunk of createReadStream(path)) hash.update(chunk);
   return hash.digest("hex");
}
/** A successful suite is reusable only for identical inputs and media executables. */
export async function mediaVerificationFingerprint(root: string, ffmpeg: string, ffprobe: string): Promise<string> {
   const files = ["bun.lock", "package.json", "electron.vite.config.ts", "tsconfig.json"];
   async function walk(relative: string): Promise<void> {
      for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
         const path = `${relative}/${entry.name}`;
         if (entry.isDirectory()) await walk(path);
         else if (entry.isFile()) files.push(path);
         else throw new Error("Media verification inputs must not contain symbolic links.");
      }
   }
   for (const directory of ["src", "scripts", "tests"]) await walk(directory);
   const fingerprint = createHash("sha256");
   fingerprint.update(JSON.stringify([1, process.platform, process.arch, process.version, process.versions["bun"] ?? null]));
   for (const path of files.sort()) fingerprint.update(`${path}\0${await fileHash(join(root, path))}\0`);
   fingerprint.update(await fileHash(ffmpeg));
   fingerprint.update(await fileHash(ffprobe));
   return fingerprint.digest("hex");
}
export async function canReuseMediaVerification(receipt: string, root: string, ffmpeg: string, ffprobe: string): Promise<boolean> {
   try {
      const value = JSON.parse(await readFile(receipt, "utf8")) as { version?: unknown; fingerprint?: unknown } | null;
      return value?.version === 1 && typeof value.fingerprint === "string" && value.fingerprint === (await mediaVerificationFingerprint(root, ffmpeg, ffprobe));
   } catch {
      return false;
   }
}
