import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, appendFile, readdir, chmod, rename } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { mediaArchives } from "./media-lock.ts";

async function archiveMatches(path: string, sha256: string): Promise<boolean> {
   try {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      return hash.digest("hex") === sha256;
   } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
   }
}

export async function provisionMedia(): Promise<{ FFMPEG_PATH: string; FFPROBE_PATH: string }> {
   const archives = mediaArchives[`${process.platform}-${process.arch}`];
   if (!archives) throw new Error("No pinned media build for this platform.");
   await mkdir("work", { recursive: true });
   const cache = resolve("work/media-archives");
   await mkdir(cache, { recursive: true });
   const folder = await mkdtemp(resolve("work/media-toolchain-"));
   for (const archive of archives) {
      const filename = basename(new URL(archive.url).pathname);
      const path = join(cache, `${archive.sha256}-${filename}`);
      if (!(await archiveMatches(path, archive.sha256))) {
         const download = join(folder, filename);
         // curl retries on every error (--retry alone skips mid-transfer protocol
         // failures like flaky HTTP/2 hosts); the checksum below catches bad data.
         execFileSync(
            process.platform === "win32" ? "curl.exe" : "curl",
            [
               "--fail",
               "--location",
               "--show-error",
               "--silent",
               "--retry",
               "4",
               "--retry-all-errors",
               "--retry-max-time",
               "600",
               "--connect-timeout",
               "30",
               "--max-time",
               "600",
               "--output",
               download,
               archive.url,
            ],
            { stdio: "inherit", timeout: 800000 }
         );
         if (!(await archiveMatches(download, archive.sha256))) throw new Error(`Media checksum mismatch: ${archive.url}`);
         await rename(download, path);
      }
      execFileSync("tar", ["-xf", path, "-C", folder, ...(archive.files ?? [])], { stdio: "inherit" });
   }
   const files = await readdir(folder, { recursive: true });
   const paths = {} as { FFMPEG_PATH: string; FFPROBE_PATH: string };
   for (const name of ["ffmpeg", "ffprobe"] as const) {
      const filename = `${name}${process.platform === "win32" ? ".exe" : ""}`;
      const match = files.find((path) => basename(path) === filename && !path.includes("__MACOSX"));
      if (!match) throw new Error(`${filename} is missing from the pinned archives.`);
      const path = join(folder, match);
      if (process.platform !== "win32") await chmod(path, 0o755);
      execFileSync(path, ["-version"], { stdio: "ignore" });
      const variable = name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
      paths[variable] = path;
      if (process.env["GITHUB_ENV"]) await appendFile(process.env["GITHUB_ENV"], `${variable}=${path}\n`);
      console.log(`${variable}=${path}`);
   }
   return paths;
}

if (import.meta.main) await provisionMedia();
