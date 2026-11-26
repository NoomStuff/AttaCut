import { afterAll, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { windowsShell } from "./windows-shell";

afterAll(() => windowsShell.dispose());

it.runIf(process.platform === "win32")(
   "answers drive questions from one warm PowerShell",
   async () => {
      expect(await windowsShell.driveFormat(tmpdir())).toMatch(/^(NTFS|ReFS|exFAT|FAT32)$/);
      expect(await windowsShell.trashSupport(tmpdir(), 1)).toBe("yes");
      expect(await windowsShell.trashSupport(tmpdir(), 1e15)).toBe("size");
   },
   30_000
);
