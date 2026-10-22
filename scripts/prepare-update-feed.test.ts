import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

describe("update feeds", () => {
   it.each(["checksum", "size", "architecture", "unknown field", "legacy checksum", "block map size"])("rejects incorrect %s", (scenario) => {
      const folder = mkdtempSync(join(tmpdir(), "attacut-feed-invalid-"));
      try {
         const name = scenario === "architecture" ? "AttaCut-0.13.3-win-arm64-Installer.exe" : "AttaCut-0.13.3-win-x64-Installer.exe";
         writeFileSync(join(folder, name), "package");
         const checksum = createHash("sha512")
            .update(scenario === "checksum" ? "changed" : "package")
            .digest("base64");
         writeFileSync(
            join(folder, "latest.yml"),
            `version: 0.13.3\nfiles:\n  - url: ${name}\n    sha512: ${checksum}\n    size: ${scenario === "size" ? 9 : 7}\n${scenario === "block map size" ? "    blockMapSize: 100\n" : ""}${scenario === "unknown field" ? "packages: {}\n" : ""}${scenario === "legacy checksum" ? "sha512: wrong\n" : ""}`
         );
         expect(() =>
            execFileSync("bun", [resolve("scripts/prepare-update-feed.mjs"), folder, join(folder, "feed"), "v0.13.3"], { stdio: "pipe", windowsHide: true })
         ).toThrow();
      } finally {
         rmSync(folder, { recursive: true, force: true });
      }
   });
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
            writeFileSync(
               join(dist, channel),
               `version: 0.13.3\nfiles:\n  - url: ${packageName}\n    sha512: ${createHash("sha512").update("package").digest("base64")}\n    size: 7\n${channel === "latest.yml" ? "" : "    blockMapSize: 3\n"}path: ${packageName}\n`
            );
         }
         execFileSync("bun", [resolve("scripts/prepare-update-feed.mjs"), dist, feed, "v0.13.3"], { windowsHide: true });
         for (const [channel, packageName] of channels) {
            const content = readFileSync(join(feed, channel), "utf8");
            const url = `https://github.com/NoomStuff/AttaCut/releases/download/v0.13.3/${packageName}`;
            expect(content).toContain(url);
            expect(content).toContain(createHash("sha512").update("package").digest("base64"));
            if (channel !== "latest.yml") expect(content).toContain("blockMapSize: 3");
         }
      } finally {
         rmSync(folder, { recursive: true, force: true });
      }
   });
});
