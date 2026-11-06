import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

export interface UpdateLogger {
   info(message?: unknown): void;
   warn(message?: unknown): void;
   error(message?: unknown): void;
   debug(message: string): void;
}

const limit = 1024 * 1024;

/**
 * electron-updater narrates which install path it takes (direct spawn, elevate.exe or the
 * interactive fallback). Writes are synchronous so the final lines before quitAndInstall
 * reach the disk even though the process exits immediately afterwards.
 */
export function createUpdateLog(directory: string): UpdateLogger & { path: string } {
   const path = join(directory, "updater.log");
   const write = (level: string, message: unknown) => {
      try {
         mkdirSync(directory, { recursive: true });
         try {
            if (statSync(path).size > limit) renameSync(path, join(directory, "updater.old.log"));
         } catch {
            // No log yet.
         }
         const text = message instanceof Error ? (message.stack ?? message.message) : typeof message === "string" ? message : JSON.stringify(message);
         appendFileSync(path, `${new Date().toISOString()} [${level}] ${text}\n`);
      } catch {
         // Logging must never break updating.
      }
   };
   return {
      path,
      info: (message) => write("info", message),
      warn: (message) => write("warn", message),
      error: (message) => write("error", message),
      debug: (message) => write("debug", message),
   };
}
