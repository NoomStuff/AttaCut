import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, appendFile, readdir, chmod, rename, rm } from "node:fs/promises";
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

type MediaPaths = { FFMPEG_PATH: string; FFPROBE_PATH: string };

async function findBinaries(folder: string): Promise<MediaPaths> {
   const files = await readdir(folder, { recursive: true });
   const paths = {} as MediaPaths;
   for (const name of ["ffmpeg", "ffprobe"] as const) {
      const filename = `${name}${process.platform === "win32" ? ".exe" : ""}`;
      const match = files.find((path) => basename(path) === filename && !path.includes("__MACOSX"));
      if (!match) throw new Error(`${filename} is missing from the pinned archives.`);
      const path = join(folder, match);
      if (process.platform !== "win32") await chmod(path, 0o755);
      execFileSync(path, ["-version"], { stdio: "ignore" });
      paths[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"] = path;
   }
   return paths;
}

async function publish(paths: MediaPaths, quiet: boolean): Promise<MediaPaths> {
   for (const [variable, path] of Object.entries(paths)) {
      if (process.env["GITHUB_ENV"]) await appendFile(process.env["GITHUB_ENV"], `${variable}=${path}\n`);
      if (!quiet) console.log(`${variable}=${path}`);
   }
   return paths;
}

export async function provisionMedia({ quiet = false } = {}): Promise<MediaPaths> {
   const archives = mediaArchives[`${process.platform}-${process.arch}`];
   if (!archives) throw new Error("No pinned media build for this platform.");
   await mkdir("work", { recursive: true });
   // One extraction per pinned set, reused by later runs.
   const key = createHash("sha256")
      .update(archives.map((archive) => archive.sha256).join(","))
      .digest("hex")
      .slice(0, 12);
   const target = resolve(`work/media-toolchain-${key}`);
   try {
      return await publish(await findBinaries(target), quiet);
   } catch {
      await rm(target, { recursive: true, force: true });
   }
   const cache = resolve("work/media-archives");
   await mkdir(cache, { recursive: true });
   const folder = await mkdtemp(resolve("work/media-download-"));
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
      // Downloads land in the extraction folder, so drop them before it becomes the toolchain.
      await rm(join(folder, filename), { force: true });
   }
   await rename(folder, target);
   return publish(await findBinaries(target), quiet);
}

/** Local test runners use the pinned build unless FFMPEG_PATH and FFPROBE_PATH already choose one. */
export async function localMediaEnv(): Promise<Partial<MediaPaths>> {
   if (process.env["FFMPEG_PATH"] || process.env["FFPROBE_PATH"]) return {};
   if (!mediaArchives[`${process.platform}-${process.arch}`]) return {};
   const paths = await provisionMedia({ quiet: true });
   console.log(`Using pinned FFmpeg from ${paths.FFMPEG_PATH}. Set FFMPEG_PATH and FFPROBE_PATH to choose another build.`);
   return paths;
}

/**
 * CI uses the ffmpeg and ffprobe that scripts/build-media.sh built from source, which
 * are the ones releases ship. The pinned downloads above serve local development only.
 */
export async function useBuiltMedia(directory: string): Promise<{ FFMPEG_PATH: string; FFPROBE_PATH: string }> {
   const paths = {} as { FFMPEG_PATH: string; FFPROBE_PATH: string };
   for (const name of ["ffmpeg", "ffprobe"] as const) {
      const path = resolve(directory, `${name}${process.platform === "win32" ? ".exe" : ""}`);
      if (process.platform !== "win32") await chmod(path, 0o755);
      execFileSync(path, ["-version"], { stdio: "ignore" });
      const variable = name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
      paths[variable] = path;
      if (process.env["GITHUB_ENV"]) await appendFile(process.env["GITHUB_ENV"], `${variable}=${path}\n`);
      console.log(`${variable}=${path}`);
   }
   return paths;
}

if (import.meta.main) {
   const [flag, directory] = process.argv.slice(2);
   if (flag === "--from" && directory) await useBuiltMedia(directory);
   else if (!flag) await provisionMedia();
   else throw new Error("Usage: provision-media.ts [--from <built media directory>]");
}
