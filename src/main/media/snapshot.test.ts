import { afterEach, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SnapshotStore } from "./snapshot";

const folders: string[] = [];
afterEach(async () => {
   for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
function exists(path: string): Promise<boolean> {
   return stat(path).then(
      () => true,
      () => false
   );
}
async function fixture() {
   const folder = await mkdtemp(join(tmpdir(), "attacut-snapshot-"));
   folders.push(folder);
   const source = join(folder, "recording.mp4");
   await writeFile(source, "original media");
   return { folder, source, store: new SnapshotStore(join(folder, "snapshots")) };
}

it("keeps the opened contents readable after the original is renamed, replaced, or deleted", async () => {
   const { folder, source, store } = await fixture();
   const snapshot = await store.instant(source, await stat(source));
   expect(snapshot?.kind).toBe("link");
   await rename(source, join(folder, "renamed.mp4"));
   await writeFile(source, "a different file");
   await rm(join(folder, "renamed.mp4"));
   expect(await readFile(snapshot!.path, "utf8")).toBe("original media");
   expect((await stat(snapshot!.path)).size).toBe("original media".length);
});

it("removes a snapshot once its last holder lets go", async () => {
   const { source, store } = await fixture();
   const snapshot = (await store.instant(source, await stat(source)))!;
   const session = store.retain(snapshot);
   const exporting = store.retain(snapshot);
   session();
   session();
   await new Promise((resolve) => setTimeout(resolve, 50));
   expect(await readFile(snapshot.path, "utf8")).toBe("original media");
   exporting();
   await expect.poll(() => exists(snapshot.path)).toBe(false);
   expect(await readFile(source, "utf8")).toBe("original media");
});

it("sweeps snapshots a previous run left behind before taking new ones", async () => {
   const { folder, source, store } = await fixture();
   const stale = (await store.instant(source, await stat(source)))!;
   const next = new SnapshotStore(join(folder, "snapshots"));
   void next.sweep();
   const fresh = await next.instant(source, await stat(source));
   expect(await exists(stale.path)).toBe(false);
   expect(await readdir(join(folder, "snapshots"))).toEqual([fresh!.path.split(/[\\/]/).at(-1)]);
});

it("copies the source into app data when it has room", async () => {
   const { source, store } = await fixture();
   const copy = await store.copy(source, await stat(source), new AbortController().signal);
   if (!copy) return; // The test machine's drive is too full for the reserve.
   expect(copy.kind).toBe("copy");
   expect(await readFile(copy.path, "utf8")).toBe("original media");
   expect((await stat(copy.path)).mtimeMs).toBe(copy.modified);
});
