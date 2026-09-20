import { mkdir, readFile, rename, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defaultPreferences, preferencesSchema, savedSessionSchema } from "../shared/types.ts";
import type { Preferences, SavedSession } from "../shared/types.ts";
/** Bump when the on-disk format changes in a way older code cannot read; unknown versions reset to defaults. */
export const storageVersion = 1;
const envelope = z.object({ version: z.literal(storageVersion), preferences: z.unknown(), session: z.unknown() });
type Snapshot = { version: number; preferences: Preferences; session: SavedSession | null };
export class Storage {
   preferences: Preferences = structuredClone(defaultPreferences);
   session: SavedSession | null = null;
   warning: string | null = null;
   private pending: Snapshot | null = null;
   private writes: Promise<void> | null = null;
   private primaryValid = false;
   constructor(private directory: string) {}
   async load(): Promise<void> {
      const read = async (name: string) => {
         try {
            return envelope.parse(JSON.parse(await readFile(join(this.directory, name), "utf8")));
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.warning = "Saved settings could not be fully restored. Recoverable data was kept.";
            return null;
         }
      };
      const primary = await read("settings.json");
      const preferences = preferencesSchema.safeParse(primary?.preferences);
      const session = savedSessionSchema.nullable().safeParse(primary?.session);
      this.primaryValid = preferences.success && session.success;
      const backup = this.primaryValid ? null : await read("settings.backup.json");
      const recoveredPreferences = preferencesSchema.safeParse(backup?.preferences);
      const recoveredSession = savedSessionSchema.nullable().safeParse(backup?.session);
      if (preferences.success) this.preferences = preferences.data;
      else if (recoveredPreferences.success) this.preferences = recoveredPreferences.data;
      if (session.success) this.session = session.data;
      else if (recoveredSession.success) this.session = recoveredSession.data;
      if (primary && !this.primaryValid) this.warning = "Some saved settings were invalid. Recoverable preferences and edits were kept.";
   }
   save(): Promise<void> {
      this.pending = { version: storageVersion, preferences: this.preferences, session: this.session };
      if (!this.writes) {
         this.writes = Promise.resolve()
            .then(async () => {
               await mkdir(this.directory, { recursive: true });
               const target = join(this.directory, "settings.json");
               while (this.pending) {
                  const snapshot = this.pending;
                  this.pending = null;
                  await writeFile(`${target}.tmp`, JSON.stringify(snapshot));
                  if (this.primaryValid) {
                     const backup = join(this.directory, "settings.backup.json");
                     await copyFile(target, `${backup}.tmp`);
                     await rename(`${backup}.tmp`, backup);
                  }
                  await rename(`${target}.tmp`, target);
                  this.primaryValid = true;
               }
            })
            .finally(() => {
               this.writes = null;
            });
      }
      return this.writes;
   }
   async flush(): Promise<void> {
      await this.writes;
   }
}
