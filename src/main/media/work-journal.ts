import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, parse } from "node:path";
import { z } from "zod";
import { statOrNull } from "../files";
import type { RecoveredExport } from "../../shared/export";
import { errorText, log } from "../app-log";
import { configurePublishJournal, publishNew, removeTemporary } from "./publish";

const entrySchema = z.object({
   folder: z.string(),
   started: z.number(),
   publish: z.object({ temporary: z.string(), destination: z.string() }).optional(),
});
type Entry = z.infer<typeof entrySchema>;
/** A drive that stays away this long is not coming back with the folder on it. */
const forgetAfter = 30 * 24 * 60 * 60 * 1000;

/**
 * Work folders sit next to their destination, where nothing else would find them after a crash.
 * The journal lists them, and marks the moment a replacement has sent the old file to the trash
 * but not yet put the new one in its place.
 */
export class WorkJournal {
   private readonly entries = new Map<string, Entry>();
   private writing = Promise.resolve();

   private readonly file: string;

   constructor(file: string) {
      this.file = file;
   }

   add(folder: string): Promise<void> {
      this.entries.set(folder, { folder, started: Date.now() });
      return this.persist();
   }

   publishing(folder: string, temporary: string, destination: string): Promise<void> {
      this.entries.set(folder, { folder, started: this.entries.get(folder)?.started ?? Date.now(), publish: { temporary, destination } });
      return this.persist();
   }

   remove(folder: string): Promise<void> {
      if (!this.entries.delete(folder)) return Promise.resolve();
      return this.persist();
   }

   /** Settle what a previous run left behind. Call once, before any export starts. */
   async recover(): Promise<RecoveredExport[]> {
      const text = await readFile(this.file, "utf8").catch(() => "");
      const parsed = z.array(entrySchema).safeParse(
         (() => {
            try {
               return JSON.parse(text) as unknown;
            } catch {
               return [];
            }
         })()
      );
      const recovered: RecoveredExport[] = [];
      for (const entry of parsed.success ? parsed.data : []) {
         if (this.entries.has(entry.folder)) continue;
         const outcome = await settle(entry).catch((error: unknown) => {
            log(`export: could not settle an interrupted export: ${errorText(error)}`, "warn");
            return "keep" as const;
         });
         if (outcome === "keep") {
            if (Date.now() - entry.started < forgetAfter) this.entries.set(entry.folder, entry);
         } else if (outcome !== "done") recovered.push(outcome);
      }
      await this.persist();
      return recovered;
   }

   private persist(): Promise<void> {
      const text = JSON.stringify([...this.entries.values()]);
      this.writing = this.writing.then(async () => {
         try {
            await mkdir(dirname(this.file), { recursive: true });
            await writeFile(`${this.file}.tmp`, text);
            await rename(`${this.file}.tmp`, this.file);
         } catch (error) {
            log(`export: work journal write failed: ${errorText(error)}`, "warn");
         }
      });
      return this.writing;
   }
}

async function settle(entry: Entry): Promise<RecoveredExport | "done" | "keep"> {
   if (!(await statOrNull(dirname(entry.folder)).catch(() => null))) {
      // The destination's drive may only be unplugged; try again on a later start.
      const root = parse(entry.folder).root;
      return (await statOrNull(root).catch(() => null)) ? "done" : "keep";
   }
   let recovered: RecoveredExport | null = null;
   if (entry.publish) {
      const { temporary, destination } = entry.publish;
      const output = await statOrNull(temporary);
      if (output?.isFile() && !(await statOrNull(destination))) {
         await publishNew(temporary, destination);
         log("export: put an export interrupted while replacing a file in place");
         recovered = { path: destination, name: basename(destination) };
      }
   }
   await removeTemporary(entry.folder);
   return recovered ?? "done";
}

let current: WorkJournal | null = null;
export function configureWorkJournal(journal: WorkJournal | null): void {
   current = journal;
   configurePublishJournal(journal);
}
export function workJournal(): WorkJournal | null {
   return current;
}
