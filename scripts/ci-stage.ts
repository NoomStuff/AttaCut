import { copyFile, cp, lstat, mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { candidateIdentity, manifestSchema, packCandidate, sha256, targets, verifyCandidate } from "./ci-candidate";
import type { CandidateManifest } from "./ci-candidate";
import { releaseDownloads } from "./release-downloads";
import { verifyUnixPayloads } from "./verify-unix-payloads";
import { execFileSync } from "node:child_process";

const folders = ["release", "out", "resources/media", "build"];
const feeds = ["latest.yml", "latest-linux.yml", "latest-linux-arm64.yml"];
export const receiptSchema = manifestSchema.extend({ candidateSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export async function snapshotFiles(root: string): Promise<Record<string, string>> {
   const files: Record<string, string> = {};
   const visit = async (relative: string): Promise<void> => {
      const path = join(root, relative);
      const info = await lstat(path);
      if (info.isSymbolicLink()) files[relative] = `link:${await readlink(path)}`;
      else if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(`${relative}/${name}`);
      else if (info.isFile()) files[relative] = `${info.mode & 0o111}:${await sha256(path)}`;
      else throw new Error(`Unexpected candidate file type: ${path}`);
   };
   for (const folder of folders) await visit(folder);
   return files;
}

export async function assertSnapshot(root: string): Promise<void> {
   const expected: unknown = JSON.parse(await readFile(join(root, "work/ci/.ci-package-files.json"), "utf8"));
   if (JSON.stringify(await snapshotFiles(root)) !== JSON.stringify(expected)) throw new Error("Restored candidate files changed during verification.");
}

function publicationFiles(version: string, target: string): string[] {
   return [
      ...releaseDownloads(version).filter((name) => name.includes(`-${target}`) || (target === "linux-x64" && name.includes("-linux-x86_64"))),
      ...feeds.filter((name) =>
         target === "win-x64"
            ? name === "latest.yml"
            : target === "linux-x64"
              ? name === "latest-linux.yml"
              : target === "linux-arm64"
                ? name === "latest-linux-arm64.yml"
                : false
      ),
   ];
}

async function receipt(target: string): Promise<void> {
   const candidate = await verifyCandidate("work/candidate", await candidateIdentity(target));
   await assertSnapshot(".");
   const destination = "work/verified";
   await mkdir(destination, { recursive: true });
   const files: CandidateManifest["files"] = [];
   for (const name of publicationFiles(candidate.version, target)) {
      const source = join("release", name);
      const info = await lstat(source);
      if (!info.isFile() || info.size === 0) throw new Error(`Invalid publication file: ${name}`);
      await copyFile(source, join(destination, name));
      files.push({ path: name, size: info.size, sha256: await sha256(source) });
   }
   await copyFile("work/candidate/manifest.json", join(destination, "manifest.json"));
   await writeFile(
      join(destination, "receipt.json"),
      JSON.stringify({ ...candidate, candidateSha256: await sha256("work/candidate/manifest.json"), files }, null, 2) + "\n"
   );
}

export async function sealCandidates(root = "work/verified", destination = "dist"): Promise<void> {
   const names = await readdir(root);
   if (names.length !== targets.length || names.some((name) => !targets.some((target) => name === `verified-${target}`)))
      throw new Error("Expected exactly five verified targets.");
   await mkdir(destination, { recursive: true });
   if ((await readdir(destination)).length) throw new Error("Sealed destination must be empty.");
   const manifests: CandidateManifest[] = [];
   const { version } = await candidateIdentity(targets[0]);
   for (const target of targets) {
      const directory = join(root, `verified-${target}`);
      const entries = await readdir(directory);
      if (
         entries.length !== publicationFiles(version, target).length + 2 ||
         entries.some((name) => !["manifest.json", "receipt.json", ...publicationFiles(version, target)].includes(name))
      )
         throw new Error("Unexpected verified artifact files.");
      for (const name of ["manifest.json", "receipt.json"])
         if (!(await lstat(join(directory, name))).isFile()) throw new Error("Verification metadata must be regular files.");
      const candidate = manifestSchema.parse(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
      const receipt = receiptSchema.parse(JSON.parse(await readFile(join(directory, "receipt.json"), "utf8")));
      if (receipt.candidateSha256 !== (await sha256(join(directory, "manifest.json")))) throw new Error("Candidate manifest digest mismatch.");
      const expected = await candidateIdentity(target);
      for (const field of ["schemaVersion", "commit", "version", "target", "runId", "inputsSha256"] as const) {
         if (candidate[field] !== expected[field] || receipt[field] !== expected[field]) throw new Error(`Verification identity mismatch: ${field}`);
      }
      const wanted = publicationFiles(version, target);
      const files = receipt.files;
      if (files.length !== wanted.length || new Set(files.map((file) => file.path)).size !== files.length || files.some((file) => !wanted.includes(file.path)))
         throw new Error(`Invalid verified target file list: ${target}`);
      const downloads = directory;
      for (const file of files) {
         const source = join(downloads, file.path);
         const info = await lstat(source);
         if (!info.isFile() || info.size !== file.size || (await sha256(source)) !== file.sha256)
            throw new Error(`Verified download bytes mismatch: ${file.path}`);
         await copyFile(source, join(destination, file.path));
      }
      manifests.push(candidate);
   }
   const expected = [...releaseDownloads(version), ...feeds];
   const actual = await readdir(destination);
   if (actual.length !== expected.length || expected.some((name) => !actual.includes(name))) throw new Error("Incomplete release target set.");
   // Exercise updater validation for private candidates too, before publication.
   execFileSync("bun", ["scripts/prepare-update-feed.mjs", destination, join(destination, "feed"), `v${version}`], { stdio: "inherit" });
   await writeFile(join(destination, "candidate-manifests.json"), JSON.stringify(manifests, null, 2) + "\n");
}

if (import.meta.main) {
   const [command, target] = process.argv.slice(2);
   if (command === "pack" && target) {
      await verifyUnixPayloads(true);
      const snapshot = "work/candidate-snapshot";
      await mkdir(snapshot, { recursive: true });
      for (const folder of folders) await cp(folder, join(snapshot, folder), { recursive: true, verbatimSymlinks: true });
      await mkdir(join(snapshot, "work/ci"), { recursive: true });
      if (process.platform !== "win32") await copyFile("work/ci/unix-payloads.json", join(snapshot, "work/ci/unix-payloads.json"));
      await writeFile(join(snapshot, "work/ci/.ci-package-files.json"), JSON.stringify(await snapshotFiles(snapshot)));
      await packCandidate(target, snapshot, "work/candidate");
   } else if (command === "receipt" && target) await receipt(target);
   else if (command === "seal" && !target) await sealCandidates();
   else throw new Error("Usage: ci-stage.ts <pack|receipt> <target> | seal");
}
