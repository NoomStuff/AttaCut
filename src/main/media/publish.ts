import { link, open, rename, rm, stat, utimes } from "node:fs/promises";
import { samePath, statOrNull } from "../files";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hasSnapshot } from "./probe.ts";
import type { ProbedSource } from "./probe.ts";

/** Milliseconds since the epoch, as Node reports them. */
export interface FileTimes {
   accessed: number;
   modified: number;
   created: number;
}
export interface PublishOptions {
   /** Move a file this replaces to the Recycle Bin instead of discarding it. */
   trash?: boolean;
   /** Copy these onto the published file. */
   times?: FileTimes;
   /** The source has a snapshot, so its original may be gone without changing the edit. */
   sourceMayBeMissing?: boolean;
}

/** How exports of `source` publish: replacements go to the trash and the source's dates carry over. */
export function exportPublishOptions(source: ProbedSource): PublishOptions {
   return {
      trash: true,
      sourceMayBeMissing: hasSnapshot(source),
      ...(source.times ? { times: { accessed: source.times.accessed, modified: source.modified, created: source.times.created } } : {}),
   };
}

let trashFile: ((path: string) => Promise<void>) | null = null;
/** The desktop shell supplies the platform trash. Without one, replacements are refused. */
export function configureTrash(trash: ((path: string) => Promise<void>) | null): void {
   trashFile = trash;
}
export const trashName = process.platform === "win32" ? "Recycle Bin" : "Trash";

async function moveToTrash(path: string): Promise<void> {
   const refused = () =>
      new Error(`AttaCut couldn't move "${basename(path)}" to the ${trashName}, so it was left unchanged. Export under a different name instead.`);
   if (!trashFile) throw refused();
   try {
      await trashFile(path);
   } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EBUSY" || /being used by another process|resource busy/i.test(String(error)))
         throw Object.assign(new Error(`"${basename(path)}" is open in another app. Close it there and try again.`), { code: "EBUSY" });
      throw refused();
   }
   if (await statOrNull(path)) throw refused();
}

/** Publish verified output; replacements require explicit approval. */
export async function publishOutput(
   temporary: string,
   destination: string,
   overwrite = false,
   source?: string,
   replaceSource = false,
   options: PublishOptions = {}
): Promise<void> {
   if (source) await protectSource(source, destination, replaceSource, options.sourceMayBeMissing);
   if (overwrite) {
      if (options.trash && (await statOrNull(destination))) {
         await moveToTrash(destination);
         await publishNew(temporary, destination).catch((error: unknown) => {
            throw new Error(`The original "${basename(destination)}" is in the ${trashName}, but the new file couldn't take its place. ${String(error)}`);
         });
      } else {
         // Both paths are on the destination volume. Keep the old file until the new
         // export has finished verification, then replace it in one filesystem operation.
         await rename(temporary, destination);
      }
   } else await publishNew(temporary, destination);
   if (options.times) await copyFileTimes(destination, options.times).catch(() => undefined);
}

async function publishNew(temporary: string, destination: string): Promise<void> {
   try {
      await link(temporary, destination);
   } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EPERM", "ENOTSUP", "ENOSYS"].includes(code ?? "")) throw error;
      const output = await open(destination, "wx");
      try {
         await pipeline(createReadStream(temporary), output.createWriteStream());
      } catch (copyError) {
         await output.close().catch(() => undefined);
         await rm(destination, { force: true }).catch(() => undefined);
         throw copyError;
      } finally {
         await output.close().catch(() => undefined);
      }
   }
   await rm(temporary, { force: true }).catch(() => undefined);
}

/** Give an export the source's file dates. Linux cannot set a creation date. */
export async function copyFileTimes(path: string, times: FileTimes): Promise<void> {
   const accessed = new Date(times.accessed);
   // On macOS, moving the modified date before the creation date moves the creation date with it.
   if (process.platform === "darwin" && times.created > 0 && times.created < times.modified) await utimes(path, accessed, new Date(times.created));
   await utimes(path, accessed, new Date(times.modified));
   if (process.platform === "win32" && times.created > 0) {
      const ticks = BigInt(Math.round(times.created * 10_000)) + 621_355_968_000_000_000n;
      await promisify(execFile)(
         "powershell.exe",
         ["-NoProfile", "-NonInteractive", "-Command", "[IO.File]::SetCreationTimeUtc($env:ATTACUT_FILE, [DateTime]::new([long]$env:ATTACUT_TICKS, 'Utc'))"],
         { env: { ...process.env, ATTACUT_FILE: path, ATTACUT_TICKS: String(ticks) }, windowsHide: true, timeout: 15_000 }
      );
   }
}

/** Remove a work directory. Windows keeps handles open briefly after a killed child, so retry. */
export async function removeTemporary(path: string): Promise<void> {
   for (let attempt = 0; ; attempt++) {
      try {
         await rm(path, { recursive: true, force: true });
         return;
      } catch (error) {
         const code = (error as NodeJS.ErrnoException).code;
         if (attempt >= 5 || !["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(code ?? "")) throw error;
         await delay(100 * (attempt + 1));
      }
   }
}

export async function protectSource(source: string, destination: string, replaceSource = false, sourceMayBeMissing = false): Promise<boolean> {
   const original = await stat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" && sourceMayBeMissing) return null;
      if (error.code === "ENOENT") throw new Error("The original file changed. Reopen it before exporting.");
      throw error;
   });
   const output = await statOrNull(destination);
   const replacing = samePath(source, destination);
   if (replacing && !replaceSource) throw new Error("Confirm replacing the source video before exporting.");
   if (!replacing && output && original && output.dev === original.dev && output.ino === original.ino)
      throw new Error("This filename is linked to the source video. Choose a different filename.");
   if (output && !output.isFile()) throw new Error("An output filename belongs to a folder. Choose a different filename.");
   return replacing;
}
