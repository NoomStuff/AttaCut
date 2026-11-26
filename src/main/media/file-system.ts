import { execFile } from "node:child_process";
import { realpath, statfs } from "node:fs/promises";
import { promisify } from "node:util";
import { windowsShell } from "../windows-shell.ts";

const run = promisify(execFile);
/** Linux reports FAT12, FAT16 and FAT32 volumes with this statfs type. */
const msdosMagic = 0x4d44;

/** Whether `directory` is on a FAT drive, which can't hold a file of 4 GiB or more. Unknown answers are false. */
export async function onFatDrive(directory: string): Promise<boolean> {
   if (process.platform === "win32") return /^FAT(32)?$/i.test(await windowsShell.driveFormat(directory).catch(() => ""));
   if (process.platform === "linux") return (await statfs(directory).catch(() => null))?.type === msdosMagic;
   if (process.platform !== "darwin") return false;
   const [path, mounts] = await Promise.all([
      realpath(directory).catch(() => directory),
      run("/sbin/mount").then(
         ({ stdout }) => stdout,
         () => ""
      ),
   ]);
   return mountType(path, mounts) === "msdos";
}

/** The file system type of the deepest mount containing `path`, from `mount` output such as "/dev/disk4s1 on /Volumes/CARD (msdos, local)". */
export function mountType(path: string, mounts: string): string | null {
   let best: { point: string; type: string } | null = null;
   for (const line of mounts.split("\n")) {
      const match = /^.+? on (.+) \(([^,)]+)/.exec(line);
      if (!match) continue;
      const [, point, type] = match as unknown as [string, string, string];
      const inside = point === "/" || path === point || path.startsWith(`${point}/`);
      if (inside && (!best || point.length > best.point.length)) best = { point, type };
   }
   return best?.type ?? null;
}
