import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RecentFiles } from "./recent.ts";
import { recentFileLimit, type RecentFile } from "../shared/recent.ts";

const folders: string[] = [];
const folder = async () => {
   const path = await mkdtemp(join(tmpdir(), "attacut-recent-"));
   folders.push(path);
   return path;
};
const file = (directory: string, name: string, kind: RecentFile["kind"] = "video"): RecentFile => ({
   path: join(directory, name),
   name,
   directory,
   duration: 12,
   kind,
});

afterEach(async () => {
   await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("RecentFiles", () => {
   it("keeps newest first, moves a reopened file to the top, and persists", async () => {
      const directory = await folder();
      const recent = new RecentFiles(directory);
      await recent.add(file(directory, "a.mp4"));
      await recent.add(file(directory, "b.mp4"));
      await recent.add(file(directory, "a.mp4"));
      expect(recent.files.map((item) => item.name)).toEqual(["a.mp4", "b.mp4"]);
      const reloaded = new RecentFiles(directory);
      await reloaded.load();
      expect(reloaded.files).toEqual(recent.files);
   });

   it("caps the list and drops invalid entries without losing valid ones", async () => {
      const directory = await folder();
      const recent = new RecentFiles(directory);
      for (let index = 0; index < recentFileLimit + 3; index++) await recent.add(file(directory, `${index}.mp4`));
      expect(recent.files).toHaveLength(recentFileLimit);
      expect(recent.files[0]!.name).toBe(`${recentFileLimit + 2}.mp4`);
      const saved = JSON.parse(await readFile(join(directory, "recent.json"), "utf8")) as { files: unknown[] };
      await writeFile(join(directory, "recent.json"), JSON.stringify({ version: 1, files: [{ path: "" }, ...saved.files.slice(0, 2)] }));
      const reloaded = new RecentFiles(directory);
      await reloaded.load();
      expect(reloaded.files).toHaveLength(2);
   });

   it("starts empty from a damaged file", async () => {
      const directory = await folder();
      await writeFile(join(directory, "recent.json"), "{nope");
      const recent = new RecentFiles(directory);
      await recent.load();
      expect(recent.files).toEqual([]);
   });

   it("flags moved files and removes the store when cleared", async () => {
      const directory = await folder();
      await writeFile(join(directory, "here.mp4"), "");
      const recent = new RecentFiles(directory);
      await recent.add(file(directory, "gone.mp4"));
      await recent.add(file(directory, "here.mp4"));
      expect((await recent.entries()).map((item) => [item.name, item.missing])).toEqual([
         ["here.mp4", false],
         ["gone.mp4", true],
      ]);
      const changes: number[] = [];
      recent.onChange((files) => changes.push(files.length));
      await recent.clear();
      expect(changes).toEqual([0]);
      expect(existsSync(join(directory, "recent.json"))).toBe(false);
   });
});
