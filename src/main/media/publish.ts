import { link, open, rename, rm, stat, utimes } from "node:fs/promises";
import { samePath, statOrNull } from "../files";
import { createReadStream } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { windowsShell } from "../windows-shell.ts";
import type { TrashSupport } from "../windows-shell.ts";
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

export interface Trash {
   move: (path: string) => Promise<void>;
   /** Whether the trash would keep this file. Windows silently deletes what its Recycle Bin cannot hold. */
   support?: (path: string, size: number) => Promise<TrashSupport>;
}
let trash: Trash | null = null;
/** The desktop shell supplies the platform trash. Without one, replacements are refused. */
export function configureTrash(value: Trash | ((path: string) => Promise<void>) | null): void {
   trash = typeof value === "function" ? { move: value } : value;
}
/** Records a replacement in flight, so a crash between its two steps cannot lose the new file. */
export interface PublishJournal {
   publishing: (folder: string, temporary: string, destination: string) => Promise<void>;
}
let journal: PublishJournal | null = null;
export function configurePublishJournal(value: PublishJournal | null): void {
   journal = value;
}
export const trashName = process.platform === "win32" ? "Recycle Bin" : "Trash";

/** A replacement refused before anything changed. `permanent` means retrying cannot help. */
function trashRefusal(message: string, permanent: boolean): Error {
   return Object.assign(new Error(message), { code: "ETRASH", permanent });
}

/** Why `path` cannot go to the trash, or null when it can. Unknown answers allow it, as before the check existed. */
export async function trashProblem(path: string): Promise<Error | null> {
   const name = `"${basename(path)}"`;
   if (!trash) return trashRefusal(`AttaCut couldn't move ${name} to the ${trashName}, so it was left unchanged. Export under a different name instead.`, true);
   const info = await statOrNull(path);
   if (!info || !trash.support) return null;
   const support = await trash.support(path, info.size).catch(() => "yes" as const);
   const refuse = (reason: string) => trashRefusal(`${reason}, so AttaCut won't replace it. Export under a different name instead.`, true);
   if (support === "removable" || support === "other") return refuse(`${name} is on a drive without a ${trashName}`);
   if (support === "network") return refuse(`${name} is on a network drive without a ${trashName}`);
   if (support === "off") return refuse(`This drive's ${trashName} deletes files right away instead of keeping ${name}`);
   if (support === "size") return refuse(`${name} is too big for this drive's ${trashName}`);
   return null;
}

/** `trashProblem` for exports that check ahead; without a configured trash, publishing refuses on its own. */
export function replacementProblem(path: string): Promise<Error | null> {
   return trash ? trashProblem(path) : Promise.resolve(null);
}

async function moveToTrash(path: string): Promise<void> {
   const problem = await trashProblem(path);
   if (problem) throw problem;
   const name = `"${basename(path)}"`;
   // AttaCut's own readers can hold the file for a moment after the editor lets go of it.
   for (let attempt = 0; ; attempt++) {
      try {
         await trash!.move(path);
         break;
      } catch {
         if (attempt < 3) {
            await delay(300);
            continue;
         }
         throw trashRefusal(
            `AttaCut couldn't move ${name} to the ${trashName}, so it was left unchanged. If it's open in another app, close it and try again.`,
            false
         );
      }
   }
   if (await statOrNull(path))
      throw trashRefusal(`AttaCut couldn't move ${name} to the ${trashName}, so it was left unchanged. Export under a different name instead.`, false);
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
         await journal?.publishing(dirname(temporary), temporary, destination);
         await moveToTrash(destination);
         await publishNew(temporary, destination).catch(async (error: unknown) => {
            const original = `The original "${basename(destination)}" is in the ${trashName}, but the new file couldn't take its place`;
            const beside = await publishBeside(temporary, destination).catch(() => null);
            if (beside) throw new Error(`${original}, so it was saved as "${basename(beside)}". ${String(error)}`);
            throw new Error(`${original}. ${String(error)}`);
         });
      } else {
         // Both paths are on the destination volume. Keep the old file until the new
         // export has finished verification, then replace it in one filesystem operation.
         await rename(temporary, destination);
      }
   } else await publishNew(temporary, destination);
   if (options.times) await copyFileTimes(destination, options.times).catch(() => undefined);
}

export async function publishNew(temporary: string, destination: string): Promise<void> {
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

/** Keep a finished file under the next free name beside its destination. */
async function publishBeside(temporary: string, destination: string): Promise<string> {
   const extension = extname(destination);
   const stem = basename(destination, extension);
   for (let suffix = 2; ; suffix++) {
      const path = join(dirname(destination), `${stem} (${suffix})${extension}`);
      try {
         await publishNew(temporary, path);
         return path;
      } catch (error) {
         if ((error as NodeJS.ErrnoException).code !== "EEXIST" || suffix >= 20) throw error;
      }
   }
}

/** Give an export the source's file dates. Linux cannot set a creation date. */
export async function copyFileTimes(path: string, times: FileTimes): Promise<void> {
   const accessed = new Date(times.accessed);
   // On macOS, moving the modified date before the creation date moves the creation date with it.
   if (process.platform === "darwin" && times.created > 0 && times.created < times.modified) await utimes(path, accessed, new Date(times.created));
   await utimes(path, accessed, new Date(times.modified));
   if (process.platform === "win32" && times.created > 0) await windowsShell.setCreated(path, times.created);
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
      if (error.code === "ENOENT") throw new Error("The original file was moved or deleted. Locate it, then export again.");
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
