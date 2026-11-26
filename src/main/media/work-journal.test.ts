import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureWorkJournal, WorkJournal } from "./work-journal";
import { withTemporaryOutput } from "./transaction";

const folders: string[] = [];
afterEach(async () => {
   configureWorkJournal(null);
   for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture() {
   const folder = await mkdtemp(join(tmpdir(), "attacut-journal-"));
   folders.push(folder);
   const file = join(folder, "app", "work-journal.json");
   const work = join(folder, ".attacut-interrupted");
   await mkdir(work);
   return { folder, file, work };
}
function exists(path: string): Promise<boolean> {
   return stat(path).then(
      () => true,
      () => false
   );
}

it("puts an export a crash left between trashing the old file and placing the new one", async () => {
   const { folder, file, work } = await fixture();
   const temporary = join(work, "output.mp4");
   const destination = join(folder, "clip.mp4");
   await writeFile(temporary, "finished export");
   await new WorkJournal(file).publishing(work, temporary, destination);
   const recovered = await new WorkJournal(file).recover();
   expect(recovered).toEqual([{ path: destination, name: "clip.mp4" }]);
   expect(await readFile(destination, "utf8")).toBe("finished export");
   expect(await exists(work)).toBe(false);
   expect(JSON.parse(await readFile(file, "utf8"))).toEqual([]);
});

it("removes leftover work without touching a destination that was already published", async () => {
   const { folder, file, work } = await fixture();
   const destination = join(folder, "clip.mp4");
   await writeFile(join(work, "output.mp4"), "finished export");
   await writeFile(destination, "published");
   const previous = new WorkJournal(file);
   await previous.publishing(work, join(work, "output.mp4"), destination);
   const encoding = join(folder, ".attacut-encoding");
   await mkdir(encoding);
   await previous.add(encoding);
   expect(await new WorkJournal(file).recover()).toEqual([]);
   expect(await readFile(destination, "utf8")).toBe("published");
   expect(await exists(work)).toBe(false);
   expect(await exists(encoding)).toBe(false);
});

it("tracks work folders only while they exist", async () => {
   const { folder, file } = await fixture();
   const journal = new WorkJournal(file);
   configureWorkJournal(journal);
   let during: unknown[] = [];
   await withTemporaryOutput(folder, ".attacut-", async () => {
      during = JSON.parse(await readFile(file, "utf8")) as unknown[];
   });
   expect(during).toHaveLength(1);
   expect(JSON.parse(await readFile(file, "utf8"))).toEqual([]);
});

it("starts clean from a missing or damaged journal", async () => {
   const { file } = await fixture();
   expect(await new WorkJournal(file).recover()).toEqual([]);
   await writeFile(file, "{not json");
   expect(await new WorkJournal(file).recover()).toEqual([]);
});
