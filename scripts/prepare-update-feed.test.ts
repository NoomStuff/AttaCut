import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("update feeds", () => {
   it("points each channel to its exact GitHub release package", () => {
      const folder = mkdtempSync(join(tmpdir(), "attacut-feed-"));
      try {
         const dist = join(folder, "dist");
         const feed = join(folder, "feed");
         mkdirSync(dist);
         const channels = [
            ["latest.yml", "AttaCut-0.13.3-win-x64-Installer.exe"],
            ["latest-linux.yml", "AttaCut-0.13.3-linux-x86_64.AppImage"],
            ["latest-linux-arm64.yml", "AttaCut-0.13.3-linux-arm64.AppImage"],
         ] as const;
         for (const [channel, packageName] of channels) {
            writeFileSync(join(dist, packageName), "package");
            writeFileSync(join(dist, channel), `version: 0.13.3\nfiles:\n  - url: ${packageName}\n    sha512: aGVsbG8=\npath: ${packageName}\n`);
         }
         execFileSync("bun", [resolve("scripts/prepare-update-feed.mjs"), dist, feed, "v0.13.3"]);
         for (const [channel, packageName] of channels) {
            const content = readFileSync(join(feed, channel), "utf8");
            const url = `https://github.com/NoomStuff/AttaCut/releases/download/v0.13.3/${packageName}`;
            expect(content).toContain(url);
            expect(content).toContain("aGVsbG8=");
         }
      } finally {
         rmSync(folder, { recursive: true, force: true });
      }
   });
});
