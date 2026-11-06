import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const recordSchema = z.object({ fromVersion: z.string(), targetVersion: z.string() });
export type InstallRecord = z.infer<typeof recordSchema>;

export const installRecordName = "update-install.json";

/** Written just before the app hands itself to the installer. */
export async function writeInstallRecord(directory: string, record: InstallRecord): Promise<void> {
   await writeFile(join(directory, installRecordName), JSON.stringify(record));
}

export async function clearInstallRecord(directory: string): Promise<void> {
   await rm(join(directory, installRecordName), { force: true });
}

/**
 * Read once at launch and always cleared. A launch that still runs the version that
 * started the install means the installer did not apply the update.
 */
export async function takeInstallOutcome(directory: string, currentVersion: string): Promise<{ applied: boolean; targetVersion: string } | null> {
   const path = join(directory, installRecordName);
   let text: string;
   try {
      text = await readFile(path, "utf8");
   } catch {
      return null;
   }
   await rm(path, { force: true }).catch(() => undefined);
   const parsed = recordSchema.safeParse(
      (() => {
         try {
            return JSON.parse(text) as unknown;
         } catch {
            return null;
         }
      })()
   );
   if (!parsed.success) return null;
   return { applied: parsed.data.fromVersion !== currentVersion, targetVersion: parsed.data.targetVersion };
}
