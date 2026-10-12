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

it("pins Intel Mac tools to the verified published package and extracts only media files", () => {
   const archives = mediaArchives["darwin-x64"]!;
   expect(archives).toHaveLength(1);
   const archive = archives[0]!;
   expect(archive.url).toBe("https://github.com/NoomStuff/AttaCut/releases/download/v0.21.3/AttaCut-0.21.3-mac-x64.zip");
   expect(archive.sha256).toBe("26dbe2083da81d30929e2ff2307541e9b5080e61335e341dd57db6b528ee6f57");
   expect(archive.files).toEqual([
      "AttaCut.app/Contents/Resources/media/ffmpeg",
      "AttaCut.app/Contents/Resources/media/ffprobe",
      "AttaCut.app/Contents/Resources/media/provenance.json",
   ]);
});
