import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { publishRelease } from "./publish-release";
import { releaseDownloads } from "./release-downloads";

it.each([
   "valid",
   "retry draft",
   "retry duplicate drafts",
   "draft on later page",
   "retry public",
   "public changed",
   "stale",
   "superseded upload",
   "wrong tag",
   "corrupt upload",
   "wrong commit",
   "lookup failure",
   "published during cleanup",
])("publication guards: %s", async (scenario) => {
   const folder = await mkdtemp(join(tmpdir(), "attacut-publish-"));
   try {
      const sha = "a".repeat(40);
      const downloads = join(folder, "downloads");
      await mkdir(downloads);
      const names = releaseDownloads("0.25.0");
      for (const name of names) await writeFile(join(downloads, name), "app");
      const release = {
         id: 1,
         tag_name: "v0.25.0",
         draft: scenario !== "public changed" && scenario !== "retry public",
         target_commitish: sha,
         assets: names.map((name) => ({ name, size: 3, digest: "sha256:" + createHash("sha256").update("app").digest("hex") })),
      };
      const hasExisting = [
         "retry draft",
         "retry duplicate drafts",
         "draft on later page",
         "retry public",
         "public changed",
         "published during cleanup",
      ].includes(scenario);
      let releases = hasExisting ? [release] : [];
      if (scenario === "retry duplicate drafts") releases.push({ ...release, id: 2, target_commitish: "c".repeat(40) });
      let mainReads = 0;
      const gh = vi.fn((...args: string[]): string => {
         if (args[0] === "release" && args[1] === "create") {
            expect(args).toContain("--notes");
            expect(args[args.indexOf("--notes") + 1]).toBe("");
            expect(args).not.toContain("--notes-file");
            releases = [
               {
                  ...release,
                  id: 3,
                  draft: true,
                  target_commitish: scenario === "wrong commit" ? "b".repeat(40) : sha,
                  assets: scenario === "corrupt upload" ? release.assets.map((asset) => ({ ...asset, digest: "bad" })) : release.assets,
               },
            ];
            return "";
         }
         const path = args.find((arg) => arg.startsWith("repos/"))!;
         if (args.includes("--method")) {
            const method = args[args.indexOf("--method") + 1];
            const id = Number(path.split("/").at(-1));
            if (method === "DELETE") releases = releases.filter((item) => item.id !== id);
            else if (method === "PATCH") {
               expect(args).toContain("draft=false");
               releases = releases.map((item) => (item.id === id ? { ...item, draft: false } : item));
            } else throw new Error("Unexpected mutation");
            return "{}";
         }
         if (path.endsWith("git/ref/heads/main"))
            return JSON.stringify({ object: { sha: scenario === "stale" || (scenario === "superseded upload" && mainReads++ > 0) ? "b".repeat(40) : sha } });
         if (path.includes("releases?")) {
            if (scenario === "lookup failure") throw new Error("Unauthorized");
            const page = Number(new URL("https://api.github.com/" + path).searchParams.get("page"));
            const filler =
               scenario === "draft on later page" ? Array.from({ length: 20 }, (_, index) => ({ ...release, id: index + 100, tag_name: `v0.0.${index}` })) : [];
            return JSON.stringify([...filler, ...releases].slice((page - 1) * 20, page * 20));
         }
         if (path.includes("matching-refs")) return JSON.stringify(scenario === "wrong tag" ? [{ ref: "refs/tags/v0.25.0" }] : []);
         if (path.includes("commits/")) return JSON.stringify({ sha: scenario === "public changed" ? "b".repeat(40) : sha });
         if (path.includes("releases/")) {
            const found = releases.find((item) => item.id === Number(path.split("/").at(-1)));
            if (!found) throw new Error("Release not found by ID");
            return JSON.stringify(scenario === "published during cleanup" ? { ...found, draft: false } : found);
         }
         throw new Error(`Unexpected gh call: ${args.join(" ")}`);
      });
      const successful = ["valid", "retry draft", "retry duplicate drafts", "draft on later page", "retry public"].includes(scenario);
      const pending = publishRelease({ sha, tag: "v0.25.0", run: "123", repository: "NoomStuff/AttaCut" }, gh, downloads);
      if (successful) await pending;
      else await expect(pending).rejects.toThrow();
      const mutations = gh.mock.calls.filter((args) => args.includes("--method"));
      expect(mutations.filter((args) => args.includes("PATCH"))).toHaveLength(successful && scenario !== "retry public" ? 1 : 0);
      if (["retry public", "public changed", "published during cleanup"].includes(scenario)) expect(mutations).toHaveLength(0);
      if (scenario === "retry duplicate drafts") expect(mutations.filter((args) => args.includes("DELETE"))).toHaveLength(2);
      if (scenario === "draft on later page") expect(gh.mock.calls.some((args) => args.some((arg) => arg.includes("&page=2")))).toBe(true);
   } finally {
      await rm(folder, { recursive: true, force: true });
   }
});
