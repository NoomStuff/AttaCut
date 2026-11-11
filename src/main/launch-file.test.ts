import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { fileArgument } from "./launch-file";

test("second launches resolve relative video and project paths in the launcher's directory", () => {
   const directory = mkdtempSync(join(tmpdir(), "attacut-launch-"));
   try {
      for (const name of ["video with spaces.MP4", "edit.attacut", "clip #1 % café.mp4"]) {
         const path = join(directory, name);
         writeFileSync(path, "");
         expect(fileArgument(["--ignored.mp4", "missing.mp4", name], directory)).toBe(path);
         expect(fileArgument([path], "/")).toBe(path);
         expect(fileArgument([pathToFileURL(join(directory, "missing", "video.mp4")).href, pathToFileURL(path).href], "/")).toBe(path);
      }
      expect(fileArgument(["missing.mp4"], directory)).toBeNull();
   } finally {
      rmSync(directory, { recursive: true });
   }
});
