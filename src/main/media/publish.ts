import { constants, copyFile, link, rm } from "node:fs/promises";

/** Publish without replacing an existing file, including on volumes without hard links. */
export async function publishOutput(temporary: string, destination: string): Promise<void> {
   try {
      await link(temporary, destination);
   } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EXDEV", "EPERM", "ENOTSUP", "ENOSYS"].includes(code ?? "")) throw error;
      await copyFile(temporary, destination, constants.COPYFILE_EXCL);
   }
   await rm(temporary, { force: true });
}
