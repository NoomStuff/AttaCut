import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { assertSafeArchivePaths, candidateIdentity, packCandidate, sha256, verifyCandidate } from "./ci-candidate";
import type { CandidateManifest } from "./ci-candidate";

it.each(["valid", "bytes", "extra", "missing", "duplicate", "traversal", "commit", "target", "runId", "version", "inputsSha256"])(
   "candidate guard: %s",
   async (scenario) => {
      const directory = await mkdtemp(join(tmpdir(), "ci-candidate-"));
      try {
         const expected = {
            schemaVersion: 1 as const,
            commit: "a".repeat(40),
            version: "1.2.3",
            target: "win-x64" as const,
            runId: "123",
            inputsSha256: "b".repeat(64),
         };
         const path = join(directory, "payload.tar");
         await writeFile(path, "app");
         const manifest: CandidateManifest = { ...expected, files: [{ path: "payload.tar", size: 3, sha256: await sha256(path) }] };
         if (scenario === "bytes") await writeFile(path, "bad");
         if (scenario === "extra") await writeFile(join(directory, "extra"), "unverified");
         if (scenario === "missing") await rm(path);
         if (scenario === "duplicate") manifest.files.push(manifest.files[0]!);
         if (scenario === "traversal") manifest.files[0]!.path = "../payload.tar";
         if (scenario === "commit") manifest.commit = "c".repeat(40);
         if (scenario === "target") manifest.target = "linux-arm64";
         if (scenario === "runId") manifest.runId = "124";
         if (scenario === "version") manifest.version = "1.2.4";
         if (scenario === "inputsSha256") manifest.inputsSha256 = "c".repeat(64);
         await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
         if (scenario === "valid") await expect(verifyCandidate(directory, expected)).resolves.toEqual(manifest);
         else await expect(verifyCandidate(directory, expected)).rejects.toThrow();
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   }
);

it.each(["../outside", "./ok/../../outside", "/absolute", "C:/absolute", "folder\\file", ""])("rejects unsafe archive members %s", (listing) => {
   expect(() => assertSafeArchivePaths(listing)).toThrow();
});

it("retains exact artifacts across a separate restore and rejects later corruption", async () => {
   const root = await mkdtemp(join(tmpdir(), "ci-roundtrip-"));
   vi.stubEnv("CANDIDATE_SHA", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
   vi.stubEnv("GITHUB_RUN_ID", "123");
   try {
      const snapshot = join(root, "snapshot");
      const candidate = join(root, "candidate");
      const restored = join(root, "restored");
      await mkdir(snapshot);
      await writeFile(join(snapshot, "download.exe"), "exact app bytes");
      if (process.platform !== "win32") await symlink("download.exe", join(snapshot, "app-link"));
      await packCandidate("win-x64", snapshot, candidate);
      // Run the actual Bun runtime against an existing current directory. Bun
      // 1.4.2 on Windows throws EEXIST for recursive mkdir("."). Keep the
      // disposable checkout identity separate from the user's working directory.
      await mkdir(restored);
      await copyFile("package.json", join(restored, "package.json"));
      const moduleUrl = pathToFileURL(resolve("scripts/ci-candidate.ts")).href;
      execFileSync(
         "bun",
         [
            "-e",
            `const { restoreCandidate } = await import(${JSON.stringify(moduleUrl)}); await restoreCandidate("win-x64", ${JSON.stringify(candidate)}, ".");`,
         ],
         {
            cwd: restored,
            env: { ...process.env, GIT_DIR: execFileSync("git", ["rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).trim() },
            stdio: "pipe",
            windowsHide: true,
         }
      );
      expect(await readFile(join(restored, "download.exe"), "utf8")).toBe("exact app bytes");
      await writeFile(join(candidate, "payload.tar"), "corrupted");
      await expect(verifyCandidate(candidate, await candidateIdentity("win-x64"))).rejects.toThrow("bytes mismatch");
   } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
   }
});
