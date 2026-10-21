import { execFileSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
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

export async function publishRelease(candidate: Candidate, gh: Gh, directory = "dist/downloads"): Promise<void> {
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
   const releaseByTag = (): Release | undefined => {
      let response: string;
      try {
         response = gh("api", "--include", `repos/${repository}/releases/tags/${tag}`);
      } catch (error) {
         const output = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
         if (/^HTTP\/\S+ 404\b/m.test(output)) return undefined;
         throw error;
      }
      const boundary = /\r?\n\r?\n/.exec(response);
      if (!boundary) throw new Error("Missing release API response headers.");
      return JSON.parse(response.slice(boundary.index + boundary[0].length)) as Release;
   };
   const existing = releaseByTag();
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
   if (existing && !existing.draft) {
      // Retrying the publication job can repair feeds without changing public files.
      if (api<{ sha: string }>(`commits/${tag}`).sha !== sha) throw new Error(`${tag} is public at another commit.`);
      await verifyAssets(existing);
      return;
   }
   if (api<{ ref: string }[]>(`git/matching-refs/tags/${tag}`).some((ref) => ref.ref === `refs/tags/${tag}`))
      throw new Error("An unpublished candidate must not reserve a version tag.");
   if (existing) gh("release", "delete", tag, "--yes");
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
      "--notes",
      `Verified candidate ${sha}\nRelease workflow ${run}, attempt ${attempt}.`,
      ...(tag.includes("-") ? ["--prerelease"] : [])
   );
   assertCurrent();
   const draft = releaseByTag();
   if (!draft?.draft || draft.target_commitish !== sha) throw new Error("Draft candidate does not match this run.");
   await verifyAssets(draft);
   assertCurrent();
   // Publishing creates the absent tag at the draft's verified target_commitish.
   gh("release", "edit", tag, "--draft=false");
   if (api<{ sha: string }>(`commits/${tag}`).sha !== sha) throw new Error("Published tag does not match the verified commit.");
}

if (import.meta.main) {
   const { GITHUB_SHA: sha, RELEASE_TAG: tag, GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt, GITHUB_REPOSITORY: repository } = process.env;
   if (!sha || !tag || !run || !attempt || !repository) throw new Error("Missing verified candidate identity.");
   await publishRelease({ sha, tag, run, attempt, repository }, (...args) =>
      execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
   );
}
