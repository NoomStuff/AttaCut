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
   /** Kill the child after this much silence on stdout and stderr; a hung process must never pin an export. */
   idleTimeoutMs?: number;
   onProgress?: ((fraction: number) => void) | undefined;
   /**
    * Consume stdout line by line instead of buffering it. Used for whole-file scans whose
    * output grows with recording length; only a short tail is kept for error text.
    */
   onLines?: ((line: string) => void) | undefined;
}
/** ffmpeg and ffprobe stream progress or results continuously, so two minutes of total silence means a wedged decoder or stalled disk. */
const defaultIdleTimeoutMs = 120_000;
const killGraceMs = 5_000;
export function runMedia(name: "ffmpeg" | "ffprobe", args: string[], options: RunOptions = {}): Promise<string> {
   return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
         reject(new Error("Cancelled"));
         return;
      }
      const child = spawn(binaryPath(name), args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const idleLimit = options.idleTimeoutMs ?? defaultIdleTimeoutMs;
      let stdout = "";
      let stderr = "";
      let pendingLine = "";
      let processError: Error | null = null;
      let settled = false;
      let idleTimer: NodeJS.Timeout | null = null;
      let killTimer: NodeJS.Timeout | null = null;
      const disarm = () => {
         if (idleTimer) clearTimeout(idleTimer);
         if (killTimer) clearTimeout(killTimer);
         options.signal?.removeEventListener("abort", stop);
      };
      const stop = () => {
         if (settled || killTimer) return;
         if (idleTimer) clearTimeout(idleTimer);
         child.kill();
         killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
      };
      // Handle abort ourselves: spawn's signal rejects on "error" before stdio closes.
      // Callers must not remove export files until the child has released them.
      options.signal?.addEventListener("abort", stop, { once: true });
      const armIdle = () => {
         if (idleLimit <= 0 || killTimer || settled) return;
         if (idleTimer) clearTimeout(idleTimer);
         idleTimer = setTimeout(() => {
            processError ??= new Error(`${name} stopped responding and was stopped.`);
            stop();
         }, idleLimit);
      };
      armIdle();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
         armIdle();
         for (const match of data.matchAll(/out_time_us=(\d+)/g)) {
            if (options.duration) options.onProgress?.(Math.min(0.99, Number(match[1]) / 1e6 / options.duration));
         }
         if (options.onLines) {
            stdout = (stdout + data).slice(-4096);
            pendingLine += data;
            const lines = pendingLine.split(/\r?\n/);
            pendingLine = lines.pop() ?? "";
            for (const line of lines) if (line) options.onLines(line);
            return;
         }
         stdout += data;
         if (stdout.length > 64 * 1024 * 1024) {
            processError ??= new Error("Media analysis returned too much data.");
            stop();
         }
      });
      child.stderr.on("data", (data: string) => {
         armIdle();
         stderr = (stderr + data).slice(-12000);
      });
      child.on("error", (error) => {
         if (settled) return;
         processError ??= error.message.includes("ENOENT")
            ? new Error(`${name} was not found. Install FFmpeg or set ${name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"}.`)
            : error;
         if (child.pid) {
            stop();
            return;
         }
         settled = true;
         disarm();
         reject(options.signal?.aborted ? new Error("Cancelled") : processError);
      });
      child.on("close", (code) => {
         if (settled) return;
         settled = true;
         disarm();
         if (options.onLines && pendingLine) {
            options.onLines(pendingLine);
            pendingLine = "";
         }
         if (code === 0 && !processError && !options.signal?.aborted) resolve(stdout);
         else reject(options.signal?.aborted ? new Error("Cancelled") : (processError ?? new Error(stderr.trim() || `${name} exited with code ${code}`)));
      });
   });
}
export const ffmpegBase = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
