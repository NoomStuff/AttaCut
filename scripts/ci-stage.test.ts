import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { candidateIdentity, sha256, targets } from "./ci-candidate";
import type { CandidateManifest } from "./ci-candidate";
import { assertSnapshot, sealCandidates, snapshotFiles } from "./ci-stage";

it("detects changes to the restored app even when the original tar is unchanged", async () => {
   const root = await mkdtemp(join(tmpdir(), "attacut-snapshot-"));
   try {
      for (const folder of ["release", "out", "resources/media", "build"]) await mkdir(join(root, folder), { recursive: true });
      const app = join(root, "release", "app.exe");
      await writeFile(app, "app");
      await mkdir(join(root, "work/ci"), { recursive: true });
      await writeFile(join(root, "work/ci/.ci-package-files.json"), JSON.stringify(await snapshotFiles(root)));
      await expect(assertSnapshot(root)).resolves.toBeUndefined();
      await writeFile(app, "bad");
      await expect(assertSnapshot(root)).rejects.toThrow("changed during verification");
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});

it.each([
   "valid",
   "missing target",
   "extra target",
   "wrong commit",
   "wrong run",
   "wrong manifest",
   "changed bytes",
   "missing file",
   "extra file",
   "wrong feed",
])("release seal: %s", async (scenario) => {
   const root = await mkdtemp(join(tmpdir(), "attacut-seal-"));
   vi.stubEnv("CANDIDATE_SHA", execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
   vi.stubEnv("GITHUB_RUN_ID", "123");
   try {
      const verified = join(root, "verified");
      const destination = join(root, "sealed");
      const { version } = await candidateIdentity("win-x64");
      const sha512 = createHash("sha512").update("app").digest("base64");
      for (const target of targets) {
         const directory = join(verified, `verified-${target}`);
         await mkdir(directory, { recursive: true });
         const identity = await candidateIdentity(target);
         const original: CandidateManifest = { ...identity, files: [{ path: "payload.tar", size: 3, sha256: "a".repeat(64) }] };
         await writeFile(join(directory, "manifest.json"), JSON.stringify(original));
         const names =
            target === "win-x64"
               ? [`AttaCut-${version}-win-x64.exe`, `AttaCut-${version}-win-x64-Installer.exe`]
               : target.startsWith("mac-")
                 ? [`AttaCut-${version}-${target}.zip`, `AttaCut-${version}-${target}.dmg`]
                 : [`AttaCut-${version}-${target === "linux-x64" ? "linux-x86_64" : target}.AppImage`];
         for (const name of names) await writeFile(join(directory, name), "app");
         const feed =
            target === "win-x64" ? "latest.yml" : target === "linux-x64" ? "latest-linux.yml" : target === "linux-arm64" ? "latest-linux-arm64.yml" : undefined;
         if (feed) {
            const name = names.at(-1)!;
            names.push(feed);
            await writeFile(
               join(directory, feed),
               JSON.stringify({ version, files: [{ url: name, size: 3, sha512: scenario === "wrong feed" ? "bad" : sha512 }] })
            );
         }
         const files: CandidateManifest["files"] = [];
         for (const name of names) {
            const data = await readFile(join(directory, name));
            files.push({ path: name, size: data.length, sha256: await sha256(join(directory, name)) });
         }
         await writeFile(
            join(directory, "receipt.json"),
            JSON.stringify({
               ...identity,
               commit: scenario === "wrong commit" ? "c".repeat(40) : identity.commit,
               runId: scenario === "wrong run" ? "124" : identity.runId,
               candidateSha256: scenario === "wrong manifest" ? "b".repeat(64) : await sha256(join(directory, "manifest.json")),
               files,
            })
         );
      }
      const win = join(verified, "verified-win-x64");
      if (scenario === "missing target") await rm(win, { recursive: true });
      if (scenario === "extra target") await mkdir(join(verified, "verified-unknown"));
      if (scenario === "changed bytes") await writeFile(join(win, `AttaCut-${version}-win-x64.exe`), "bad");
      if (scenario === "missing file") await rm(join(win, `AttaCut-${version}-win-x64.exe`));
      if (scenario === "extra file") await copyFile(join(win, `AttaCut-${version}-win-x64.exe`), join(win, "extra.exe"));
      if (scenario === "valid") {
         await sealCandidates(verified, destination);
         expect(await readFile(join(destination, `AttaCut-${version}-win-x64.exe`), "utf8")).toBe("app");
         expect(JSON.parse(await readFile(join(destination, "candidate-manifests.json"), "utf8"))).toHaveLength(5);
      } else await expect(sealCandidates(verified, destination)).rejects.toThrow();
   } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
   }
});
