import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { removeTemporary } from "./publish";
import { workJournal } from "./work-journal";
import { errorText, log } from "../app-log";

/** Work stays on the destination volume. Cleanup cannot undo publication or hide the original failure. */
export async function withTemporaryOutput<T>(directory: string, prefix: string, work: (temporary: string) => Promise<T>): Promise<T> {
   const temporary = await mkdtemp(join(directory, prefix));
   const journal = workJournal();
   await journal?.add(temporary);
   try {
      return await work(temporary);
   } finally {
      await removeTemporary(temporary).then(
         () => journal?.remove(temporary),
         (error: unknown) => log(`export: temporary cleanup failed: ${errorText(error)}`, "warn")
      );
   }
}
