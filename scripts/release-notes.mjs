// Release notes: the commits since the previous release, one line each. Shared line for
// line by AcroClip, AttaCut and Deduup.
//
// Usage: bun scripts/release-notes.mjs <tag> <commit>   (needs the gh CLI and GH_REPO)
import { execFileSync } from "node:child_process";
import process from "node:process";

/**
 * @param {{ tag: string, commit: string, api: (path: string) => Promise<any> }} options
 *    `api` fetches a path below repos/<owner>/<repo>/ from the GitHub REST API.
 * @returns {Promise<string>} Markdown, empty when no earlier release exists.
 */
export async function releaseNotes({ tag, commit, api }) {
   /** @type {{ tag_name: string, draft: boolean, prerelease: boolean }[]} */
   const releases = await api("releases?per_page=100");
   // Releases list newest first. Skip this version's own draft and source prereleases.
   const previous = releases.find((release) => !release.draft && !release.prerelease && release.tag_name !== tag && /^v\d+\.\d+\.\d+$/.test(release.tag_name));
   if (!previous) return "";
   /** @type {{ commits: { sha: string, parents: unknown[], commit: { message: string } }[] }} */
   const comparison = await api(`compare/${previous.tag_name}...${commit}`);
   return (
      comparison.commits
         .filter((entry) => entry.parents.length < 2)
         .map((entry) => ({ sha: entry.sha, subject: entry.commit.message.split("\n")[0]?.trim() ?? "" }))
         // A version-only commit is the release itself, not a change in it.
         .filter((entry) => entry.subject && !/^Release \d+\.\d+\.\d+$/.test(entry.subject))
         .map((entry) => `- ${entry.subject} (${entry.sha.slice(0, 7)})`)
         .join("\n")
   );
}

if (import.meta.main) {
   const [tag, commit] = process.argv.slice(2);
   const repository = process.env["GH_REPO"] ?? process.env["GITHUB_REPOSITORY"];
   if (!tag || !commit || !repository) throw new Error("Usage: GH_REPO=<owner/repo> bun scripts/release-notes.mjs <tag> <commit>");
   const api = async (/** @type {string} */ path) =>
      JSON.parse(execFileSync("gh", ["api", `repos/${repository}/${path}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }));
   process.stdout.write(await releaseNotes({ tag, commit, api }));
}
