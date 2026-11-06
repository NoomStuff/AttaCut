import { copyFile, rename, stat } from "node:fs/promises";
import type { Stats } from "node:fs";
import { resolve } from "node:path";

/** File stats, or null when nothing exists at the path. Every other failure still throws. */
export async function statOrNull(path: string): Promise<Stats | null> {
   try {
      return await stat(path);
   } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
   }
}

/** Cache identity for a path. Windows paths compare case-insensitively. */
export function pathKey(path: string): string {
   return process.platform === "win32" ? path.toLowerCase() : path;
}

/** Whether two paths name the same location, the way the platform compares them. */
export function samePath(a: string, b: string): boolean {
   return pathKey(resolve(a)) === pathKey(resolve(b));
}

/** Copy through a sibling temporary so readers never see a partial file. */
export async function copyAtomically(from: string, to: string): Promise<void> {
   await copyFile(from, `${to}.tmp`);
   await rename(`${to}.tmp`, to);
}
