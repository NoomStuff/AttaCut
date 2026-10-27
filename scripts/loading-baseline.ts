import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { requireDisposableDesktop } from "./test-isolation";

/** Build both revisions on one runner so CPU differences cannot masquerade as speedups. */
export function prepareLoadingBaseline(revision: string): string {
   requireDisposableDesktop();
   const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
   if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("The loading baseline must be an exact commit SHA.");
   git(["fetch", "--no-tags", "origin", revision]);
   mkdirSync(resolve("work"), { recursive: true });
   const folder = mkdtempSync(join(resolve("work"), "loading-baseline-"));
   git(["worktree", "add", "--detach", folder, revision]);
   console.log(`Loading baseline source: ${revision}`);
   for (const args of [
      ["install", "--frozen-lockfile"],
      ["run", "build"],
   ])
      execFileSync(process.execPath, args, { cwd: folder, stdio: "inherit", windowsHide: true });
   return folder;
}
