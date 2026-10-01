import { link, open, rename, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";

/** Publish verified output; replacements require explicit approval. */
export async function publishOutput(temporary: string, destination: string, overwrite = false, source?: string, replaceSource = false): Promise<void> {
   if (source) await protectSource(source, destination, replaceSource);
   if (overwrite) {
      // Both paths are on the destination volume. Keep the old file until the new
      // export has finished verification, then replace it in one filesystem operation.
      await rename(temporary, destination);
      return;
   }
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

export async function protectSource(source: string, destination: string, replaceSource = false): Promise<boolean> {
   const original = await stat(source).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") throw new Error("The original file changed. Reopen it before exporting.");
      throw error;
   });
   const output = await stat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
   });
   const samePath =
      process.platform === "win32" ? resolve(source).toLowerCase() === resolve(destination).toLowerCase() : resolve(source) === resolve(destination);
   if (samePath && !replaceSource) throw new Error("Confirm replacing the source video before exporting.");
   if (!samePath && output && output.dev === original.dev && output.ino === original.ino)
      throw new Error("This filename is linked to the source video. Choose a different filename.");
   if (output && !output.isFile()) throw new Error("An output filename belongs to a folder. Choose a different filename.");
   return samePath;
}
