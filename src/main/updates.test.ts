import { describe, expect, it } from "vitest";
import { fetchAvailableUpdate, isNewerVersion } from "./updates.ts";

describe("update checker", () => {
   it("compares release versions by numeric parts", () => {
      expect(isNewerVersion("1.0.0", "1.0.0-rc.1")).toBe(true);
      expect(isNewerVersion("1.0.0-rc.2", "1.0.0-rc.10")).toBe(false);
      expect(isNewerVersion("1.0.0-alpha", "1.0.0")).toBe(false);
      expect(isNewerVersion("1.0.0+build.2", "1.0.0+build.1")).toBe(false);
      expect(isNewerVersion("v0.8.0", "0.7.9")).toBe(true);
      expect(isNewerVersion("0.10.0", "0.9.9")).toBe(true);
      expect(isNewerVersion("0.7.1", "0.7.1")).toBe(false);
      expect(isNewerVersion("0.6.9", "0.7.0")).toBe(false);
   });

   it("maps a newer stable GitHub release", async () => {
      const update = await fetchAvailableUpdate(
         "0.7.1",
         async () =>
            new Response(
               JSON.stringify({
                  tag_name: "v0.8.0",
                  name: "Quicker cuts",
                  html_url: "https://github.com/NoomStuff/AttaCut/releases/tag/v0.8.0",
                  draft: false,
                  prerelease: false,
               })
            )
      );
      expect(update).toEqual({ version: "0.8.0", name: "Quicker cuts", url: "https://github.com/NoomStuff/AttaCut/releases/tag/v0.8.0", mode: "releases" });
   });
});
