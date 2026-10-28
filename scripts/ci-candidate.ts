import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

export const targets = ["win-x64", "linux-x64", "linux-arm64", "mac-x64", "mac-arm64"] as const;
const fileSchema = z
   .object({ path: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/), size: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
   .strict();
export const manifestSchema = z
   .object({
      schemaVersion: z.literal(1),
      commit: z.string().regex(/^[a-f0-9]{40}$/),
      version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/),
      target: z.enum(targets),
      runId: z.string().regex(/^[1-9]\d*$/),
      inputsSha256: z.string().regex(/^[a-f0-9]{64}$/),
      files: z.array(fileSchema).min(1),
   })
   .strict();
export type CandidateManifest = z.infer<typeof manifestSchema>;

export async function sha256(path: string): Promise<string> {
   const hash = createHash("sha256");
   for await (const chunk of createReadStream(path)) hash.update(chunk);
   return hash.digest("hex");
}

export async function candidateIdentity(target: string): Promise<Omit<CandidateManifest, "files">> {
   // Git object IDs avoid CRLF differences between Windows and Unix checkouts.
   const recipes = execFileSync("git", ["ls-tree", "-r", "HEAD", "--", "package.json", "bun.lock", "scripts", ".github/workflows"], { encoding: "utf8" });
   const hash = createHash("sha256").update(recipes);
   const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: unknown };
   const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
   if (process.env["CANDIDATE_SHA"] !== commit) throw new Error("Checkout does not match the selected candidate.");
   return manifestSchema
      .omit({ files: true })
      .parse({ schemaVersion: 1, commit, version, target, runId: process.env["GITHUB_RUN_ID"], inputsSha256: hash.digest("hex") });
}

export async function verifyCandidate(directory: string, expected: Omit<CandidateManifest, "files">): Promise<CandidateManifest> {
   const manifest = manifestSchema.parse(JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")));
   for (const field of ["schemaVersion", "commit", "version", "target", "runId", "inputsSha256"] as const)
      if (manifest[field] !== expected[field]) throw new Error(`Candidate identity mismatch: ${field}`);
   const names = manifest.files.map((file) => file.path);
   if (new Set(names).size !== names.length) throw new Error("Duplicate candidate file.");
   const actual = await readdir(directory);
   if (actual.length !== names.length + 1 || actual.some((name) => name !== "manifest.json" && !names.includes(name)))
      throw new Error("Candidate file list mismatch.");
   for (const file of manifest.files) {
      const path = join(directory, file.path);
      const info = await lstat(path);
      if (!info.isFile() || info.size !== file.size || (await sha256(path)) !== file.sha256) throw new Error(`Candidate bytes mismatch: ${file.path}`);
   }
   if (!(await lstat(join(directory, "manifest.json"))).isFile()) throw new Error("Manifest must be a regular file.");
   return manifest;
}

export async function packCandidate(target: string, snapshot: string, directory: string): Promise<void> {
   const identity = await candidateIdentity(target);
   await mkdir(directory, { recursive: true });
   if ((await readdir(directory)).length) throw new Error("Candidate destination must be empty.");
   // Tar retains executable permissions and the framework links in macOS apps.
   execFileSync("tar", ["-cf", resolve(directory, "payload.tar"), "-C", snapshot, "."], { stdio: "inherit" });
   const path = join(directory, "payload.tar");
   const manifest: CandidateManifest = { ...identity, files: [{ path: "payload.tar", size: (await lstat(path)).size, sha256: await sha256(path) }] };
   await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

export function assertSafeArchivePaths(listing: string): void {
   const paths = listing.split(/\r?\n/).filter(Boolean);
   if (!paths.length || paths.some((path) => path.startsWith("/") || path.includes("\\") || path.includes(":") || path.split("/").includes("..")))
      throw new Error("Unsafe candidate archive path.");
}

export async function restoreCandidate(target: string, directory: string, destination: string): Promise<CandidateManifest> {
   const manifest = await verifyCandidate(directory, await candidateIdentity(target));
   if (manifest.files.length !== 1 || manifest.files[0]?.path !== "payload.tar") throw new Error("Expected one candidate payload.");
   const archive = resolve(directory, "payload.tar");
   assertSafeArchivePaths(execFileSync("tar", ["-tf", archive], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
   await mkdir(resolve(destination), { recursive: true });
   execFileSync("tar", ["-xf", archive, "-C", destination], { stdio: "inherit" });
   return manifest;
}

if (import.meta.main) {
   const [command, target, directory, destination, ...extra] = process.argv.slice(2);
   if (!target || !directory || extra.length) throw new Error("Usage: ci-candidate.ts <pack|restore|receipt|verify> <target> <directory> [destination]");
   if (command === "pack" && destination) await packCandidate(target, directory, destination);
   else if (command === "restore" && destination) await restoreCandidate(target, directory, destination);
   else if (command === "receipt" && destination) {
      await verifyCandidate(directory, await candidateIdentity(target));
      await mkdir(resolve(destination), { recursive: true });
      await copyFile(join(directory, "manifest.json"), join(destination, "manifest.json"));
   } else if (command === "verify" && !destination) await verifyCandidate(directory, await candidateIdentity(target));
   else throw new Error("Invalid candidate command.");
}
