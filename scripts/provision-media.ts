import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, appendFile, readdir, chmod } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { mediaArchives } from "./media-lock.ts";

export async function provisionMedia(): Promise<{ FFMPEG_PATH: string; FFPROBE_PATH: string }> {
   const archives = mediaArchives[`${process.platform}-${process.arch}`];
   if (!archives) throw new Error("No pinned media build for this platform.");
   await mkdir("work", { recursive: true });
   const folder = await mkdtemp(resolve("work/media-toolchain-"));
   for (const archive of archives) {
      const path = join(folder, basename(new URL(archive.url).pathname));
      // curl retries transient HTTP/connection failures and truncates partial downloads.
      execFileSync(
         process.platform === "win32" ? "curl.exe" : "curl",
         [
            "--fail",
            "--location",
            "--show-error",
            "--silent",
            "--retry",
            "4",
            "--retry-connrefused",
            "--retry-max-time",
            "600",
            "--connect-timeout",
            "30",
            "--max-time",
            "180",
            "--output",
            path,
            archive.url,
         ],
         { stdio: "inherit", timeout: 800000 }
      );
      const data = await readFile(path);
      if (createHash("sha256").update(data).digest("hex") !== archive.sha256) throw new Error(`Media checksum mismatch: ${archive.url}`);
      execFileSync("tar", ["-xf", path, "-C", folder], { stdio: "inherit" });
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
