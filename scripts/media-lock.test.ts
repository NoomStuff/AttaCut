import { expect, it } from "vitest";
import { mediaArchives } from "./media-lock";

it("pins Windows and Linux to retained month-end archives rather than expiring daily builds", () => {
   for (const platform of ["win32-x64", "linux-x64", "linux-arm64"]) {
      const archive = mediaArchives[platform]![0]!;
      const date = /autobuild-(\d{4})-(\d{2})-(\d{2})-/.exec(archive.url)!;
      const lastDay = new Date(Date.UTC(Number(date[1]), Number(date[2]), 0)).getUTCDate();
      expect(Number(date[3])).toBe(lastDay);
      expect(archive.sha256).toMatch(/^[a-f0-9]{64}$/);
   }
});
