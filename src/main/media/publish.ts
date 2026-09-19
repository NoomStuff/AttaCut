import { constants, copyFile, link, rename, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

/** Publish verified output; replacements require explicit approval. */
export async function publishOutput(temporary: string, destination: string, overwrite = false, source?: string): Promise<void> {
   if (source) await protectSource(source, destination);
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
      await copyFile(temporary, destination, constants.COPYFILE_EXCL);
   }
   await rm(temporary, { force: true });
}

export async function protectSource(source: string, destination: string): Promise<void> {
   const original = await stat(source);
   const output = await stat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
   });
   if (resolve(source) === resolve(destination) || (output && output.dev === original.dev && output.ino === original.ino))
      throw new Error("The original video cannot be replaced. Choose a different filename or folder.");
   if (output && !output.isFile()) throw new Error("An output filename belongs to a folder. Choose a different filename.");
}
