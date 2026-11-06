import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { recentFileLimit, recentFileSchema, type RecentEntry, type RecentFile } from "../shared/recent.ts";
import { samePath, statOrNull } from "./files.ts";

const document = z.object({ version: z.literal(1), files: z.array(z.unknown()) });

/**
 * Recently opened videos and projects, newest first. Kept apart from settings.json:
 * the renderer owns preferences and rewrites them whole, while only the main process
 * learns when a file actually opened.
 */
export class RecentFiles {
   files: RecentFile[] = [];
   private writes: Promise<void> = Promise.resolve();
   private readonly path: string;
   private readonly listeners = new Set<(files: RecentFile[]) => void>();
   constructor(directory: string) {
      this.path = join(directory, "recent.json");
   }
   /** A damaged list only costs history, so it starts empty instead of failing startup. */
   async load(): Promise<void> {
      try {
         const parsed = document.parse(JSON.parse(await readFile(this.path, "utf8")));
         this.files = parsed.files.flatMap((item) => {
            const file = recentFileSchema.safeParse(item);
            return file.success ? [file.data] : [];
         });
         this.files = this.files.slice(0, recentFileLimit);
      } catch {
         this.files = [];
      }
   }
   onChange(listener: (files: RecentFile[]) => void): () => void {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
   }
   add(file: RecentFile): Promise<void> {
      this.files = [file, ...this.files.filter((item) => !samePath(item.path, file.path))].slice(0, recentFileLimit);
      return this.changed();
   }
   remove(path: string): Promise<void> {
      this.files = this.files.filter((item) => !samePath(item.path, path));
      return this.changed();
   }
   clear(): Promise<void> {
      this.files = [];
      return this.changed();
   }
   /** Entries with a missing flag, checked now: files move between visits. */
   async entries(): Promise<RecentEntry[]> {
      return Promise.all(
         this.files.map(async (file) => {
            const info = await statOrNull(file.path).catch(() => null);
            return { ...file, missing: !info?.isFile() };
         })
      );
   }
   flush(): Promise<void> {
      return this.writes;
   }
   private changed(): Promise<void> {
      const files = this.files;
      for (const listener of this.listeners) listener(files);
      // Serialize writes so an older list can never land after a newer one.
      this.writes = this.writes
         .catch(() => undefined)
         .then(async () => {
            if (!files.length) {
               await rm(this.path, { force: true });
               return;
            }
            await mkdir(dirname(this.path), { recursive: true });
            await writeFile(`${this.path}.tmp`, JSON.stringify({ version: 1, files }));
            await rename(`${this.path}.tmp`, this.path);
         });
      return this.writes;
   }
}
