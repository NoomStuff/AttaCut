import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { copyFile, link, mkdir, open, readdir, readFile, rm, rmdir, stat, statfs, utimes, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { dirname, extname, join, parse, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SourceMedia } from "./probe.ts";
import { removeTemporary } from "./publish.ts";

export type Snapshot = SourceMedia & { kind: "link" | "clone" | "copy" };

/** Space a background copy must leave free on the app's drive. */
function copyReserve(total: number): number {
   return Math.max(5 * 1024 ** 3, total * 0.1);
}

async function copyGently(from: string, to: string, signal: AbortSignal, busy: () => boolean): Promise<void> {
   const input = await open(from, "r");
   try {
      const output = await open(to, "wx");
      try {
         const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
         for (let position = 0; ;) {
            signal.throwIfAborted();
            if (busy()) await delay(250, undefined, { signal });
            const { bytesRead } = await input.read(buffer, 0, buffer.length, position);
            if (!bytesRead) return;
            await output.write(buffer, 0, bytesRead, position);
            position += bytesRead;
         }
      } finally {
         await output.close();
      }
   } finally {
      await input.close();
   }
}

function sameContent(info: Stats, original: Stats): boolean {
   return info.size === original.size && info.mtimeMs === original.mtimeMs;
}

/** The highest folder on the same volume as `path`, or null for network shares. */
export async function volumeRoot(path: string, device: number): Promise<string | null> {
   const full = resolve(path);
   if (process.platform === "win32") {
      const root = parse(full).root;
      // Hard links over SMB are unreliable, and a background copy covers those sources.
      return /^[a-z]:\\$/i.test(root) ? root : null;
   }
   let current = dirname(full);
   for (;;) {
      const parent = dirname(current);
      if (parent === current) return current;
      const info = await stat(parent).catch(() => null);
      if (!info || info.dev !== device) return current;
      current = parent;
   }
}

/**
 * Keeps a private, unchanging view of each open source: a hard link or copy-on-write clone on the
 * source's volume when the filesystem allows it, otherwise a background copy into app data.
 * The original can then move, change, or be replaced by an export without breaking the edit.
 */
export class SnapshotStore {
   private readonly folder: string;
   private readonly scope: string;
   private readonly registry: string;
   private readonly leases = new Map<string, number>();
   private swept: Promise<void> = Promise.resolve();

   constructor(folder: string) {
      this.folder = resolve(folder);
      // Folders on other volumes are shared by every AttaCut data folder, so each one keeps its own.
      this.scope = createHash("sha256").update(this.folder.toLowerCase()).digest("hex").slice(0, 12);
      this.registry = join(this.folder, "volumes.json");
   }

   /** A hard link or clone. Both are instant and use no extra space. */
   async instant(path: string, original: Stats): Promise<Snapshot | null> {
      await this.swept;
      const folder = await this.volumeFolder(path, original).catch(() => null);
      if (!folder) return null;
      const target = join(folder, `${randomUUID()}${extname(path)}`);
      try {
         await link(path, target);
         return await this.adopt(target, "link", original);
      } catch {
         await rm(target, { force: true }).catch(() => undefined);
      }
      try {
         await copyFile(path, target, constants.COPYFILE_FICLONE_FORCE);
         await utimes(target, original.atime, original.mtime);
         return await this.adopt(target, "clone", original);
      } catch {
         await rm(target, { force: true }).catch(() => undefined);
         await this.removeEmpty(folder);
         return null;
      }
   }

   /**
    * A full copy into app data, only when it leaves enough room on that drive. While `busy`
    * reports playback or scrubbing, the copy slows down so it does not compete for a slow drive.
    */
   async copy(path: string, original: Stats, signal: AbortSignal, busy: () => boolean = () => false): Promise<Snapshot | null> {
      await this.swept;
      await mkdir(this.folder, { recursive: true });
      const space = await statfs(this.folder).catch(() => null);
      if (!space || space.bavail * space.bsize - original.size < copyReserve(space.blocks * space.bsize)) return null;
      const target = join(this.folder, `${randomUUID()}${extname(path)}`);
      try {
         await copyGently(path, target, signal, busy);
         const after = await stat(path);
         if (!sameContent(after, original) || after.ino !== original.ino) throw new Error("The original changed while it was copied.");
         await utimes(target, original.atime, original.mtime);
         return await this.adopt(target, "copy", original);
      } catch {
         await removeTemporary(target).catch(() => undefined);
         return null;
      }
   }

   retain(snapshot: Snapshot): () => void {
      this.leases.set(snapshot.path, (this.leases.get(snapshot.path) ?? 0) + 1);
      let released = false;
      return () => {
         if (released) return;
         released = true;
         const count = (this.leases.get(snapshot.path) ?? 1) - 1;
         if (count > 0) {
            this.leases.set(snapshot.path, count);
            return;
         }
         this.leases.delete(snapshot.path);
         void removeTemporary(snapshot.path)
            .then(() => this.removeEmpty(dirname(snapshot.path)))
            .catch(() => undefined);
      };
   }

   /** Remove what a previous run left behind. New snapshots wait for it. */
   sweep(): Promise<void> {
      this.swept = this.clean().catch(() => undefined);
      return this.swept;
   }

   private async clean(): Promise<void> {
      const folders = [this.folder, ...(await this.externalFolders())];
      await Promise.all(
         folders.map(async (folder) => {
            const names = await readdir(folder).catch(() => [] as string[]);
            await Promise.all(names.filter((name) => name !== "volumes.json").map((name) => removeTemporary(join(folder, name)).catch(() => undefined)));
            if (folder !== this.folder) await this.removeEmpty(folder);
         })
      );
      const remaining = [];
      for (const folder of folders.slice(1)) if (await stat(folder).catch(() => null)) remaining.push(folder);
      if (remaining.length !== folders.length - 1) await writeFile(this.registry, JSON.stringify(remaining)).catch(() => undefined);
   }

   private async adopt(path: string, kind: Snapshot["kind"], original: Stats): Promise<Snapshot> {
      const info = await stat(path);
      if (info.size !== original.size || (kind === "link" && (info.ino !== original.ino || info.mtimeMs !== original.mtimeMs)))
         throw new Error("The snapshot does not match the original.");
      return { path, kind, device: info.dev, inode: info.ino, modified: info.mtimeMs };
   }

   private async volumeFolder(path: string, original: Stats): Promise<string | null> {
      await mkdir(this.folder, { recursive: true });
      if ((await stat(this.folder)).dev === original.dev) return this.folder;
      const root = await volumeRoot(path, original.dev);
      if (!root) return null;
      const shared = join(root, ".attacut-snapshots");
      const folder = join(shared, this.scope);
      await mkdir(folder, { recursive: true });
      if (process.platform === "win32") execFile("attrib", ["+h", shared], { windowsHide: true }, () => undefined);
      await this.register(folder);
      return folder;
   }

   private async externalFolders(): Promise<string[]> {
      const text = await readFile(this.registry, "utf8").catch(() => "[]");
      try {
         const value: unknown = JSON.parse(text);
         return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      } catch {
         return [];
      }
   }

   private async register(folder: string): Promise<void> {
      const known = await this.externalFolders();
      if (known.includes(folder)) return;
      await writeFile(this.registry, JSON.stringify([...known, folder]));
   }

   /** Snapshot folders on other volumes disappear once they hold nothing. */
   private async removeEmpty(folder: string): Promise<void> {
      if (resolve(folder) === this.folder) return;
      await rmdir(folder).catch(() => undefined);
      await rmdir(dirname(folder)).catch(() => undefined);
   }
}
