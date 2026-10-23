import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { releaseDownloads } from "./release-downloads";

interface Asset {
   name: string;
   size: number;
   digest: string;
}
interface Release {
   id: number;
   tag_name: string;
   draft: boolean;
   target_commitish: string;
   assets: Asset[];
}
interface Candidate {
   sha: string;
   tag: string;
   run: string;
   attempt: string;
   repository: string;
}
type Gh = (...args: string[]) => string;

export async function publishRelease(candidate: Candidate, gh: Gh, directory = "dist/downloads", notesDirectory = "release-notes"): Promise<void> {
   const { sha, tag, run, attempt, repository } = candidate;
   if (!/^[a-f0-9]{40}$/.test(sha) || !run || !attempt || !repository) throw new Error("Missing verified candidate identity.");
   const api = <T>(path: string): T => JSON.parse(gh("api", `repos/${repository}/${path}`)) as T;
   const assertCurrent = () => {
      if (api<{ object: { sha: string } }>("git/ref/heads/main").object.sha !== sha) throw new Error("A newer main commit superseded this candidate.");
   };
   assertCurrent();
   const expected = releaseDownloads(tag.slice(1));
   const names = await readdir(directory);
   if (!tag.startsWith("v") || names.length !== expected.length || names.some((name) => !expected.includes(name)))
      throw new Error("Expected exactly eight candidate downloads.");
   const assets = names.map((name) => join(directory, name));
   const releasesByTag = (): Release[] => {
      const matches: Release[] = [];
      // GitHub's tag endpoint does not return unpublished drafts. List bounded
      // pages so retries also find drafts from earlier failed candidates.
      for (let page = 1; ; page++) {
         const releases = api<Release[]>(`releases?per_page=20&page=${page}`);
         matches.push(...releases.filter((release) => release.tag_name === tag));
         if (releases.length < 20) return matches;
      }
   };
   const existing = releasesByTag();
   async function verifyAssets(release: Release): Promise<void> {
      if (release.assets.length !== names.length) throw new Error("Release download list does not match this candidate.");
      for (const name of names) {
         const path = join(directory, name);
         const asset = release.assets.find((file) => file.name === name);
         const hash = createHash("sha256");
         for await (const chunk of createReadStream(path)) hash.update(chunk);
         if (!asset || asset.size !== (await stat(path)).size || asset.digest !== `sha256:${hash.digest("hex")}`)
            throw new Error(`Uploaded download does not match verified bytes: ${name}`);
      }
   }
   const published = existing.filter((release) => !release.draft);
   if (published.length > 1) throw new Error("Multiple public releases use this tag.");
   if (published[0]) {
      // Retrying the publication job can repair feeds without changing public files.
      if (api<{ sha: string }>(`commits/${tag}`).sha !== sha) throw new Error(`${tag} is public at another commit.`);
      await verifyAssets(published[0]);
      return;
   }
   if (api<{ ref: string }[]>(`git/matching-refs/tags/${tag}`).some((ref) => ref.ref === `refs/tags/${tag}`))
      throw new Error("An unpublished candidate must not reserve a version tag.");
   // Public copy is authored for each version. CI identity belongs in provenance,
   // never in generated release text. Require notes before changing any drafts.
   const notesPath = join(notesDirectory, `${tag.slice(1)}.md`);
   const notes = await readFile(notesPath, "utf8").catch(() => {
      throw new Error(`Write user-facing release notes in ${notesPath} before publishing.`);
   });
   if (!notes.trim()) throw new Error(`User-facing release notes are empty: ${notesPath}`);
   for (const release of existing) {
      if (!Number.isSafeInteger(release.id) || release.id <= 0) throw new Error("Invalid private release identity.");
      const current = api<Release>(`releases/${release.id}`);
      if (current.id !== release.id || !current.draft || current.tag_name !== tag) throw new Error("Private release changed before cleanup.");
      gh("api", "--method", "DELETE", `repos/${repository}/releases/${release.id}`);
   }
   gh(
      "release",
      "create",
      tag,
      ...assets,
      "--draft",
      "--target",
      sha,
      "--title",
      `AttaCut ${tag.slice(1)}`,
      "--notes-file",
      notesPath,
      ...(tag.includes("-") ? ["--prerelease"] : [])
   );
   assertCurrent();
   const drafts = releasesByTag();
   const draft = drafts[0];
   if (drafts.length !== 1 || !draft?.draft || !Number.isSafeInteger(draft.id) || draft.id <= 0 || draft.target_commitish !== sha)
      throw new Error("Draft candidate does not match this run.");
   await verifyAssets(draft);
   const pending = api<Release>(`releases/${draft.id}`);
   if (!pending.draft || pending.target_commitish !== sha || pending.tag_name !== tag) throw new Error("Private candidate changed before publication.");
   assertCurrent();
   // Publishing creates the absent tag at the draft's verified target_commitish.
   gh("api", "--method", "PATCH", `repos/${repository}/releases/${draft.id}`, "-F", "draft=false");
   if (api<{ sha: string }>(`commits/${tag}`).sha !== sha) throw new Error("Published tag does not match the verified commit.");
}

if (import.meta.main) {
   const { GITHUB_SHA: sha, RELEASE_TAG: tag, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt, GITHUB_REPOSITORY: repository } = process.env;
   if (!sha || !tag || !run || !attempt || !repository) throw new Error("Missing verified candidate identity.");
   const candidate = { sha, tag, run, attempt, repository };
   await mkdir("dist", { recursive: true });
   await writeFile("dist/release-provenance.json", JSON.stringify(candidate, null, 2) + "\n");
   await publishRelease(candidate, (...args) =>
      execFileSync("gh", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }).trim()
   );
}
