// Starts a release: bump only the version on top of a main commit whose full candidate
// passed. The Release workflow then builds, verifies package bytes and publishes,
// without rerunning the suites the parent already passed.
// Usage: bun run release <major|minor|patch>
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const bump = process.argv[2];
if (bump !== "major" && bump !== "minor" && bump !== "patch") throw new Error("Usage: bun run release <major|minor|patch>");
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8" }).trim();

if (git("status", "--porcelain")) throw new Error("Commit or stash local changes first. A release commit changes only the version.");
git("fetch", "--quiet", "origin", "main");
const head = git("rev-parse", "HEAD");
if (git("branch", "--show-current") !== "main" || head !== git("rev-parse", "origin/main")) throw new Error("Check out main at origin/main first.");
const repository = git("remote", "get-url", "origin")
   .replace(/^.*github\.com[:/]/, "")
   .replace(/\.git$/, "");

// Statuses list newest first. Only the latest candidate result counts.
const statuses = JSON.parse(gh("api", `repos/${repository}/commits/${head}/statuses?per_page=100`)) as { context: string; state: string; target_url: string }[];
const candidate = statuses.find((status) => status.context === "Release candidate");
if (candidate?.state !== "success") {
   const detail = candidate ? `${candidate.state}: ${candidate.target_url}` : "no candidate run yet";
   throw new Error(`${head.slice(0, 7)} has no passing candidate (${detail}). Fix or rerun it, then release.`);
}

const manifest = await readFile("package.json", "utf8");
const current = /"version": "(\d+)\.(\d+)\.(\d+)"/.exec(manifest);
if (!current) throw new Error("package.json has no stable version.");
const [major, minor, patch] = current.slice(1).map(Number) as [number, number, number];
try {
   gh("api", `repos/${repository}/releases/tags/v${major}.${minor}.${patch}`);
} catch {
   throw new Error(`v${major}.${minor}.${patch} is not published yet. Retry that release instead of skipping a version.`);
}
const next = bump === "major" ? `${major + 1}.0.0` : bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
await writeFile("package.json", manifest.replace(current[0], `"version": "${next}"`));
git("commit", "--quiet", "--all", "--message", `Release ${next}`);
git("push", "--quiet", "origin", "main");
console.log(`Pushed Release ${next}. Watch it with: gh run list --workflow Release --limit 1`);
