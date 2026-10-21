import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { publishRelease } from "./publish-release";
import { releaseDownloads } from "./release-downloads";

it.each([
   "valid",
   "retry draft",
   "retry public",
   "public changed",
   "stale",
   "superseded upload",
   "wrong tag",
   "corrupt upload",
   "wrong commit",
   "lookup failure",
])("publication guards: %s", async (scenario) => {
   const folder = await mkdtemp(join(tmpdir(), "attacut-publish-"));
   try {
      const sha = "a".repeat(40);
      const names = releaseDownloads("0.25.0");
      for (const name of names) await writeFile(join(folder, name), "app");
      const release = {
         tag_name: "v0.25.0",
         draft: !scenario.startsWith("public") && scenario !== "retry public",
         target_commitish: scenario === "wrong commit" ? "b".repeat(40) : sha,
         assets: names.map((name) => ({ name, size: 3, digest: "sha256:" + createHash("sha256").update("app").digest("hex") })),
      };
      let mainReads = 0;
      let created = false;
      const gh = vi.fn((...args: string[]): string => {
         if (args[0] === "release") {
            if (args[1] === "create") created = true;
            return "";
         }
         const path = args.at(-1)!;
         if (path.endsWith("git/ref/heads/main"))
            return JSON.stringify({ object: { sha: scenario === "stale" || (scenario === "superseded upload" && mainReads++ > 0) ? "b".repeat(40) : sha } });
         if (path.includes("matching-refs")) return JSON.stringify(scenario === "wrong tag" ? [{ ref: "refs/tags/v0.25.0" }] : []);
         if (path.includes("commits/")) return JSON.stringify({ sha: scenario === "public changed" ? "b".repeat(40) : sha });
         if (path.includes("releases/tags/")) {
            if (scenario === "lookup failure") throw Object.assign(new Error("Unauthorized"), { stdout: "HTTP/2.0 401 Unauthorized\n\n{}" });
            if (!created && !["retry draft", "retry public", "public changed"].includes(scenario))
               throw Object.assign(new Error("Not found"), { stdout: "HTTP/2.0 404 Not Found\r\n\r\n{}" });
            return (
               "HTTP/2.0 200 OK\r\n\r\n" +
               JSON.stringify({
                  ...release,
                  assets: scenario === "corrupt upload" ? release.assets.map((asset) => ({ ...asset, digest: "bad" })) : release.assets,
               })
            );
         }
         throw new Error(`Unexpected gh call: ${args.join(" ")}`);
      });
      const pending = publishRelease({ sha, tag: "v0.25.0", run: "123", attempt: "2", repository: "NoomStuff/AttaCut" }, gh, folder);
      if (["valid", "retry draft", "retry public"].includes(scenario)) await pending;
      else await expect(pending).rejects.toThrow();
      const edits = gh.mock.calls.filter((args) => args[0] === "release" && args[1] === "edit");
      expect(edits).toHaveLength(["valid", "retry draft"].includes(scenario) ? 1 : 0);
      if (scenario === "retry public" || scenario === "public changed") expect(gh.mock.calls.some((args) => args[0] === "release")).toBe(false);
      if (scenario === "retry draft") expect(gh.mock.calls.some((args) => args[0] === "release" && args[1] === "delete")).toBe(true);
   } finally {
      await rm(folder, { recursive: true, force: true });
   }
});
