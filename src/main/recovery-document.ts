import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { savedSessionSchema } from "../shared/types";
import type { SavedSession } from "../shared/types";

/** One recovery document, including the project's last explicitly saved clips. */
export class RecoveryDocument {
   private valid = false;
   private unreadable = false;
   private last: SavedSession | null | undefined;
   private directory: string;
   constructor(directory: string) {
      this.directory = directory;
   }
   async load(): Promise<{ found: boolean; session: SavedSession | null; recovered: boolean }> {
      let found = false;
      for (const [index, name] of ["session.json", "session.backup.json"].entries()) {
         try {
            const text = await readFile(join(this.directory, name), "utf8");
            found = true;
            const document = JSON.parse(text) as { version: number; session: unknown };
            if (document.version !== 1) {
               if (index === 0) this.unreadable = true;
               continue;
            }
            const session = savedSessionSchema.nullable().parse(document.session);
            this.valid = index === 0;
            this.last = session;
            return { found: true, session, recovered: index !== 0 };
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
               found = true;
               if (index === 0) this.unreadable = true;
            }
         }
      }
      return { found, session: null, recovered: found };
   }
   async save(session: SavedSession | null): Promise<void> {
      if (session === this.last) return;
      const target = join(this.directory, "session.json");
      await writeFile(`${target}.tmp`, JSON.stringify({ version: 1, session }));
      if (this.unreadable) {
         await copyFile(target, join(this.directory, `session.unreadable-${Date.now()}.json`));
         this.unreadable = false;
      }
      if (this.valid) {
         const backup = join(this.directory, "session.backup.json");
         await copyFile(target, `${backup}.tmp`);
         await rename(`${backup}.tmp`, backup);
      }
      await rename(`${target}.tmp`, target);
      this.valid = true;
      this.last = session;
   }
   async reset(): Promise<void> {
      this.last = undefined;
      await this.save(null);
      const backup = join(this.directory, "session.backup.json");
      await copyFile(join(this.directory, "session.json"), `${backup}.tmp`);
      await rename(`${backup}.tmp`, backup);
   }
}
