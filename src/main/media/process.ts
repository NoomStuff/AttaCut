import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export function binaryPath(name: "ffmpeg" | "ffprobe"): string {
   const extension = process.platform === "win32" ? ".exe" : "";
   const configured = process.env[name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
   if (configured) return configured;
   const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
   const bundled = resources ? join(resources, "media", `${name}${extension}`) : "";
   if (bundled && existsSync(bundled)) return bundled;
   return `${name}${extension}`;
}
export interface RunOptions {
   signal?: AbortSignal | undefined;
   duration?: number;
   onProgress?: ((fraction: number) => void) | undefined;
}
export function runMedia(name: "ffmpeg" | "ffprobe", args: string[], options: RunOptions = {}): Promise<string> {
   return new Promise((resolve, reject) => {
      const child = spawn(binaryPath(name), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], signal: options.signal });
      let stdout = "";
      let stderr = "";
      let processError: Error | null = null;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
         stdout += data;
         if (stdout.length > 64 * 1024 * 1024) {
            child.kill();
            processError = new Error("Media analysis returned too much data.");
         }
         for (const match of data.matchAll(/out_time_us=(\d+)/g)) {
            if (options.duration) options.onProgress?.(Math.min(0.99, Number(match[1]) / 1e6 / options.duration));
         }
      });
      child.stderr.on("data", (data: string) => {
         stderr = (stderr + data).slice(-12000);
      });
      // Wait for stdio to close before callers remove temporary files, including on abort.
      child.on("error", (error) => {
         processError = error.message.includes("ENOENT")
            ? new Error(`${name} was not found. Install FFmpeg or set ${name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"}.`)
            : error;
      });
      child.on("close", (code) =>
         code === 0 && !processError && !options.signal?.aborted
            ? resolve(stdout)
            : reject(options.signal?.aborted ? new Error("Cancelled") : (processError ?? new Error(stderr.trim() || `${name} exited with code ${code}`)))
      );
   });
}
export const ffmpegBase = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
