import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { defaultPreferences, preferencesSchema, savedSessionSchema } from "../shared/types.ts";
import type { Preferences, SavedSession } from "../shared/types.ts";
/** Bump when the on-disk format changes in a way older code cannot read; unknown versions reset to defaults. */
export const storageVersion = 1;
const storageSchema = z.object({ version: z.literal(storageVersion), preferences: preferencesSchema, session: savedSessionSchema.nullable() });
export class Storage {
   preferences: Preferences = defaultPreferences;
   session: SavedSession | null = null;
   private writes: Promise<void> = Promise.resolve();
   constructor(private directory: string) {}
   async load(): Promise<void> {
      try {
         const data = storageSchema.parse(JSON.parse(await readFile(join(this.directory, "settings.json"), "utf8")));
         this.preferences = data.preferences;
         this.session = data.session;
      } catch {
         /* A first run or invalid settings starts with usable defaults. */
      }
   }
   save(): Promise<void> {
      const snapshot = JSON.stringify({ version: storageVersion, preferences: this.preferences, session: this.session });
      this.writes = this.writes
         .catch(() => undefined)
         .then(async () => {
            await mkdir(this.directory, { recursive: true });
            const target = join(this.directory, "settings.json");
            await writeFile(`${target}.tmp`, snapshot);
            await rename(`${target}.tmp`, target);
         });
      return this.writes;
   }
}
