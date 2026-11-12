import { expect, it } from "vitest";
// @ts-expect-error The shared notes script is plain JavaScript without declarations.
import { releaseNotes } from "./release-notes.mjs";

const commit = (sha: string, message: string, parents = 1) => ({ sha: sha.repeat(40), parents: Array(parents).fill({}), commit: { message } });

it("lists the commits since the previous release, without merges or the version bump", async () => {
   const requested: string[] = [];
   const notes = await releaseNotes({
      tag: "v0.4.0",
      commit: "c".repeat(40),
      api: async (path: string) => {
         requested.push(path);
         if (path.startsWith("releases"))
            return [
               { tag_name: "v0.4.0", draft: true, prerelease: false },
               { tag_name: "v0.3.0-sources", draft: false, prerelease: true },
               { tag_name: "v0.3.0", draft: false, prerelease: false },
            ];
         return { commits: [commit("a", "Fix the export\n\nLonger body."), commit("b", "Merge branch", 2), commit("c", "Release 0.4.0")] };
      },
   });
   expect(requested).toEqual(["releases?per_page=100", `compare/v0.3.0...${"c".repeat(40)}`]);
   expect(notes).toBe("- Fix the export (aaaaaaa)");
});

it("has no notes for the first release", async () => {
   expect(await releaseNotes({ tag: "v0.1.0", commit: "a".repeat(40), api: async () => [] })).toBe("");
});
