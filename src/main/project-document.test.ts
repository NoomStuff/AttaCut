import { afterEach, expect, it } from "vitest";
import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { savedSessionSchema } from "../shared/editing";
import { undoLimit } from "../shared/defaults";
import { isProjectPath, projectHasChanges } from "../shared/project";
import { readProject, projectSourcePaths, updateProjectSource, validateProjectSource, writeProject } from "./project-document";

const folders: string[] = [];
afterEach(async () => {
   await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function fixture() {
   const directory = await mkdtemp(join(tmpdir(), "attacut-project-"));
   folders.push(directory);
   const path = join(directory, "video.mp4");
   await writeFile(path, "source bytes");
   const info = await stat(path);
   const session = savedSessionSchema.parse({
      path,
      size: info.size,
      modified: info.mtimeMs,
      clips: [
         { id: "a", start: 1.125, end: 3.5, color: 4 },
         { id: "b", start: 5, end: 7.5, color: 1 },
      ],
      selectedId: "b",
      past: [{ clips: [{ id: "a", start: 0, end: 10, color: 0 }], selectedId: "a" }],
      future: [{ clips: [], selectedId: null }],
   });
   return { directory, session, path: join(directory, "edit.attacut") };
}

it("round trips clips and history with both source paths, without recovery metadata", async () => {
   const { session, path } = await fixture();
   const saved = await writeProject(path, session);
   const document = await readProject(path);
   expect(document.session).toEqual(session);
   expect(document.relativeSource).toBe("video.mp4");
   expect(projectSourcePaths(path, document)).toEqual([session.path]);
   expect(projectHasChanges(saved)).toBe(false);
   expect(projectHasChanges({ ...saved, clips: [] })).toBe(true);
   expect(projectHasChanges({ ...saved, selectedId: "a" })).toBe(false);
   expect(await readFile(session.path, "utf8")).toBe("source bytes");
});

it("reopens a saved project with 1,000 clips and a full undo history", async () => {
   const { session, path } = await fixture();
   const clips = Array.from({ length: 1000 }, (_, index) => ({ id: crypto.randomUUID(), start: index, end: index + 0.75, color: index % 5 }));
   const selectedId = clips[0]!.id;
   const past = Array.from({ length: undoLimit }, (_, index) => ({
      clips: [{ ...clips[0]!, end: 0.5 + index / 1000 }, ...clips.slice(1)],
      selectedId,
   }));
   const largeSession = { ...session, clips, selectedId, past, future: [] };
   await writeFile(path, JSON.stringify({ format: "AttaCut", version: 1, relativeSource: "video.mp4", session: largeSession }, null, 2));
   expect((await stat(path)).size).toBeGreaterThan(16 * 1024 * 1024);
   expect((await readProject(path)).session).toEqual(largeSession);
   await writeProject(path, largeSession);
   expect((await stat(path)).size).toBeLessThan(300 * 1024);
   const document = await readProject(path);
   expect(document.session.clips).toEqual(clips);
   expect(document.session.past).toHaveLength(undoLimit);
   expect(document.session.past.at(-1)!.clips).toEqual(past.at(-1)!.clips);
});

it("accepts the three-letter fallback extension for save and open", async () => {
   const { session, directory } = await fixture();
   expect(isProjectPath("edit.attacut")).toBe(true);
   expect(isProjectPath("edit.atc")).toBe(true);
   expect(isProjectPath("edit.attach")).toBe(false);
   expect(isProjectPath("edit.mp4")).toBe(false);
   const path = join(directory, "edit.atc");
   const saved = await writeProject(path, session);
   const document = await readProject(path);
   expect(document.session).toEqual(session);
   expect(document.relativeSource).toBe("video.mp4");
   expect(projectHasChanges(saved)).toBe(false);
});

it("updates changed path references while preserving every saved edit", async () => {
   const { directory, session, path } = await fixture();
   await writeProject(path, session);
   const document = await readProject(path);
   const movedFolder = join(directory, "moved");
   await mkdir(movedFolder);
   const movedProject = join(movedFolder, "edit.attacut");
   await writeFile(movedProject, await readFile(path));
   expect(projectSourcePaths(movedProject, document)).toEqual([join(movedFolder, "video.mp4"), session.path]);
   await updateProjectSource(movedProject, document, session.path);
   const updated = await readProject(movedProject);
   expect(updated.relativeSource).toBe("../video.mp4");
   expect(updated.session).toEqual(session);
   const newVideo = join(movedFolder, "video.mp4");
   await writeFile(newVideo, "source bytes");
   await updateProjectSource(movedProject, updated, newVideo);
   expect((await readProject(movedProject)).session).toEqual({ ...session, path: newVideo });
   expect((await readProject(movedProject)).relativeSource).toBe("video.mp4");
   const modified = (await stat(movedProject)).mtimeMs;
   await updateProjectSource(movedProject, await readProject(movedProject), newVideo);
   expect((await stat(movedProject)).mtimeMs).toBe(modified);
});

it("rejects malformed, inconsistent and unsupported projects with useful messages", async () => {
   const { session, path } = await fixture();
   await writeProject(path, session);
   const document = await readProject(path);
   await writeFile(path, "{");
   await expect(readProject(path)).rejects.toThrow("damaged or incomplete");
   await writeFile(path, JSON.stringify({ ...document, version: 3 }));
   await expect(readProject(path)).rejects.toThrow("Update AttaCut");
   await writeFile(path, JSON.stringify({ ...document, session: { ...session, clips: [{ id: "bad", start: 4, end: 3, color: 0 }] } }));
   await expect(readProject(path)).rejects.toThrow("not a valid AttaCut project");
});

it("rejects a changed source and out-of-range undo history", async () => {
   const { session } = await fixture();
   const media = { size: session.size, modified: session.modified, duration: 10 };
   expect(() => validateProjectSource(session, media)).not.toThrow();
   expect(() => validateProjectSource(session, { ...media, size: media.size + 1 })).toThrow("original video has changed");
   expect(() => validateProjectSource(session, { ...media, modified: media.modified + 1 })).toThrow("original video has changed");
   expect(() => validateProjectSource(session, { ...media, duration: 9 })).toThrow("extend past the end");
});

it("protects the source and its hard links, and keeps existing files on a failed save", async () => {
   const { session, directory, path } = await fixture();
   await expect(writeProject(session.path, session)).rejects.toThrow("cannot replace the source video");
   const alias = join(directory, "alias.attacut");
   await link(session.path, alias);
   await expect(writeProject(alias, session)).rejects.toThrow("linked to the source video");
   expect(await readFile(session.path, "utf8")).toBe("source bytes");
   await writeProject(path, session);
   const original = await readFile(path);
   await expect(writeProject(path, { ...session, path: resolve(directory, "missing.mp4") })).rejects.toThrow();
   expect(await readFile(path)).toEqual(original);
});
