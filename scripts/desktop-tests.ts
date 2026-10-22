import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { hasDisposableDesktop } from "./test-isolation";

const suites = ["ui", "playback", "native", "all", "package", "release"] as const;
type Suite = (typeof suites)[number];
function isSuite(value: string): value is Suite {
   return suites.some((suite) => suite === value);
}
const command = (args: string[]): void => {
   execFileSync(process.execPath, args, { stdio: "inherit", windowsHide: true });
};
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", windowsHide: true }).trim();

export async function runDesktopTests(suite: Suite): Promise<void> {
   if (hasDisposableDesktop()) {
      if (suite === "release") return command(["scripts/verify-release.ts"]);
      if (suite === "package") {
         command(["run", "build"]);
         command(["run", "package"]);
         return command(["scripts/verify-package.ts"]);
      }
      if (suite === "native") return command(["scripts/native-smoke.ts"]);
      if (suite === "all") command(["run", "test"]);
      if (suite === "playback" || suite === "all") command(["run", "test:media"]);
      else command(["tests/create-fixtures.ts"]);
      command(["run", "build"]);
      const projects = suite === "all" ? ["--project=ui", "--project=playback"] : [`--project=${suite}`];
      return command(["x", "--no-install", "playwright", "test", ...projects]);
   }

   // Never transmit local files or silently verify a different revision.
   if (git(["status", "--porcelain", "--untracked-files=all"])) {
      throw new Error(
         "Desktop tests did not run. This checkout has local changes. Keep them local, or explicitly commit and push the intended changes before running on an isolated runner. No files were uploaded."
      );
   }
   const revision = git(["rev-parse", "HEAD"]);
   const remote = git(["remote", "get-url", "origin"]);
   const match = /github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
   if (!match?.[1]) throw new Error("Desktop tests require a GitHub origin and authenticated gh CLI.");
   const repo = match[1];
   const commit = JSON.parse(gh(["api", `repos/${repo}/commits/${revision}`])) as { sha: string };
   if (commit.sha !== revision) throw new Error("The exact local commit is not available on origin. No desktop tests ran.");
   const target = `${process.platform}-${process.arch}`;
   if (!["win32-x64", "darwin-x64", "darwin-arm64", "linux-x64", "linux-arm64"].includes(target)) {
      throw new Error(`No disposable runner configured for ${target}. No desktop tests ran.`);
   }
   const request = randomUUID();
   const title = `Desktop ${suite} ${request}`;
   console.log(`Running ${suite} for exact commit ${revision} on a disposable ${target} runner. Local files and desktop remain untouched.`);
   gh([
      "workflow",
      "run",
      "desktop-tests.yml",
      "--repo",
      repo,
      "--ref",
      "main",
      "-f",
      `suite=${suite}`,
      "-f",
      `revision=${revision}`,
      "-f",
      `target=${target}`,
      "-f",
      `request=${request}`,
   ]);
   let run: { databaseId: number; url: string } | undefined;
   const deadline = Date.now() + 120_000;
   while (!run && Date.now() < deadline) {
      const runs = JSON.parse(
         gh([
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            "desktop-tests.yml",
            "--event",
            "workflow_dispatch",
            "--limit",
            "50",
            "--json",
            "databaseId,displayTitle,url",
         ])
      ) as { databaseId: number; displayTitle: string; url: string }[];
      run = runs.find((entry) => entry.displayTitle === title);
      if (!run) await new Promise((resolve) => setTimeout(resolve, 3000));
   }
   if (!run) throw new Error(`Dispatch ${request} was accepted but its run was not found. Check GitHub Actions. No passing result is claimed.`);
   console.log(run.url);
   execFileSync("gh", ["run", "watch", String(run.databaseId), "--repo", repo, "--exit-status", "--interval", "15"], { stdio: "inherit", windowsHide: true });
   if (git(["rev-parse", "HEAD"]) !== revision || git(["status", "--porcelain", "--untracked-files=all"])) {
      throw new Error(
         `The runner passed ${revision}, but this checkout changed during verification. That result does not validate the current local source. ${run.url}`
      );
   }
   console.log(`Desktop ${suite} passed for ${revision}. Logs, traces and source provenance: ${run.url}`);
}

if (import.meta.main) {
   const suite = process.argv[2] ?? "";
   if (!isSuite(suite)) throw new Error(`Choose a desktop suite: ${suites.join(", ")}`);
   await runDesktopTests(suite);
}
