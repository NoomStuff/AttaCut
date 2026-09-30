import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { removeTemporary } from "./publish";

/** Work stays on the destination volume. Cleanup cannot undo publication or hide the original failure. */
export async function withTemporaryOutput<T>(directory: string, prefix: string, work: (temporary: string) => Promise<T>): Promise<T> {
   const temporary = await mkdtemp(join(directory, prefix));
   try {
      return await work(temporary);
   } finally {
      await removeTemporary(temporary).catch((error: unknown) => console.warn("Export temporary cleanup failed", error));
   }
}
