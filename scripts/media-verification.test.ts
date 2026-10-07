import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { canReuseMediaVerification, mediaVerificationFingerprint } from "./media-verification";

it("reuses exact inputs and rejects changes to code, dependencies, tools or the receipt", async () => {
   const root = await mkdtemp(join(tmpdir(), "attacut-verification-"));
   try {
      for (const name of ["src", "scripts", "tests"]) await mkdir(join(root, name));
      for (const name of ["bun.lock", "package.json", "electron.vite.config.ts", "tsconfig.json", "src/media.ts"])
         await writeFile(join(root, name), "original");
      const ffmpeg = join(root, "ffmpeg");
      const ffprobe = join(root, "ffprobe");
      await writeFile(ffmpeg, "ffmpeg build");
      await writeFile(ffprobe, "ffprobe build");
      const fingerprint = await mediaVerificationFingerprint(root, ffmpeg, ffprobe);
      const receipt = join(root, "receipt.json");
      await writeFile(receipt, JSON.stringify({ version: 1, fingerprint }));
      expect(await canReuseMediaVerification(receipt, root, ffmpeg, ffprobe)).toBe(true);
      for (const name of ["src/media.ts", "bun.lock", "package.json", "ffmpeg", "ffprobe"]) {
         const original = name === "ffmpeg" ? "ffmpeg build" : name === "ffprobe" ? "ffprobe build" : "original";
         await writeFile(join(root, name), "changed");
         expect(await canReuseMediaVerification(receipt, root, ffmpeg, ffprobe)).toBe(false);
         await writeFile(join(root, name), original);
      }
      await writeFile(join(root, "tests/new-check.ts"), "new coverage");
      expect(await canReuseMediaVerification(receipt, root, ffmpeg, ffprobe)).toBe(false);
      await rm(join(root, "tests/new-check.ts"));
      await writeFile(receipt, JSON.stringify({ version: 2, fingerprint }));
      expect(await canReuseMediaVerification(receipt, root, ffmpeg, ffprobe)).toBe(false);
      await writeFile(receipt, "broken");
      expect(await canReuseMediaVerification(receipt, root, ffmpeg, ffprobe)).toBe(false);
      expect(await canReuseMediaVerification(join(root, "missing"), root, ffmpeg, ffprobe)).toBe(false);
   } finally {
      await rm(root, { recursive: true, force: true });
   }
}, 15_000);
