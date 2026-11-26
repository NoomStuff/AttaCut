import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppLog, LogFile, PathScrubber, homeRedactor, readSession } from "./app-log";
import { bugReportUrl, describeSystem } from "../shared/bug-report";

const folders: string[] = [];
afterEach(async () => {
   await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});
async function folder() {
   const directory = await mkdtemp(join(tmpdir(), "attacut-log-"));
   folders.push(directory);
   return directory;
}

describe("LogFile", () => {
   it("keeps one previous file when it rotates", async () => {
      const directory = await folder();
      const file = new LogFile(join(directory, "app.log"), 10);
      file.write("first line that is long\n");
      await file.flush();
      file.write("second\n");
      await file.flush();
      file.write("third\n");
      await file.flush();
      expect(await readFile(join(directory, "app.log.previous"), "utf8")).toBe("first line that is long\n");
      expect(await readFile(join(directory, "app.log"), "utf8")).toBe("second\nthird\n");
   });

   it("writes synchronously for a dying process", async () => {
      const directory = await folder();
      const file = new LogFile(join(directory, "nested", "app.log"), 1000, 60_000);
      file.write("pending\n");
      file.flushSync();
      expect(await readFile(join(directory, "nested", "app.log"), "utf8")).toBe("pending\n");
   });
});

describe("AppLog", () => {
   it("reports a run that never closed cleanly", async () => {
      const directory = await folder();
      let now = 1000;
      const first = new AppLog({ directory, version: "0.19.0", pid: 1, now: () => now });
      expect(await first.begin()).toBeNull();
      first.crashed("TypeError: x is undefined");
      now = 2000;
      const second = new AppLog({ directory, version: "0.20.0", pid: 2, now: () => now });
      expect(await second.begin()).toMatchObject({ version: "0.19.0", clean: false, crash: "TypeError: x is undefined" });
      second.end();
      expect(readSession(directory)).toMatchObject({ version: "0.20.0", clean: true, endedAt: 2000 });
      const third = new AppLog({ directory, version: "0.20.0", pid: 3, now: () => now });
      expect(await third.begin()).toMatchObject({ clean: true });
      expect((await third.history()).map((session) => [session.version, session.clean])).toEqual([
         ["0.19.0", false],
         ["0.20.0", true],
      ]);
   });

   it("clears logs and past runs but keeps this run's marker", async () => {
      const directory = await folder();
      await new AppLog({ directory, version: "0.20.0", pid: 1 }).begin();
      const diagnostics = new AppLog({ directory, version: "0.21.0", pid: 2, maxBytes: 10 });
      await diagnostics.begin();
      diagnostics.log("first long line");
      await diagnostics.flush();
      diagnostics.log("second");
      await diagnostics.flush();
      diagnostics.log("queued");
      await diagnostics.clear();
      expect(await diagnostics.history()).toEqual([]);
      expect(await diagnostics.entries((text) => text)).toEqual([]);
      expect(readSession(directory)).toMatchObject({ version: "0.21.0", clean: false });
      diagnostics.log("after");
      await diagnostics.flush();
      expect(await readFile(join(directory, "app.log"), "utf8")).toMatch(/INFO {2}after\n$/);
      expect(await readFile(join(directory, "app.log"), "utf8")).not.toContain("queued");
   });

   it("ignores a damaged session marker", async () => {
      const directory = await folder();
      await writeFile(join(directory, "session.json"), "{not json");
      expect(await new AppLog({ directory, version: "1.0.0" }).begin()).toBeNull();
   });

   it("exports every log with the home folder removed", async () => {
      const directory = await folder();
      const diagnostics = new AppLog({ directory, version: "1.0.0" });
      await diagnostics.begin();
      diagnostics.log("export failed for /home/alex/Videos/clip.mkv", "warn");
      const updater = join(directory, "updater.log");
      await writeFile(updater, "checked /home/alex/.config/AttaCut\n");
      const entries = await diagnostics.entries(homeRedactor("/home/alex", "linux"), [updater, join(directory, "missing.log")]);
      const names = entries.map((entry) => entry.name);
      expect(names).toEqual(["logs/app.log", "logs/updater.log"]);
      expect(String(entries[0]!.data)).toMatch(/WARN {2}export failed for ~\/Videos\/clip.mkv/);
      expect(String(entries[1]!.data)).toContain("checked ~/.config/AttaCut");
   });
});

describe("homeRedactor", () => {
   it("matches Windows paths in either case and slash direction", () => {
      const redact = homeRedactor("C:\\Users\\Alex", "win32");
      expect(redact("C:\\Users\\Alex\\Videos and c:/users/alex/AppData and C:\\\\Users\\\\Alex\\\\x")).toBe("~\\Videos and ~/AppData and ~\\\\x");
   });

   it("leaves text alone without a usable home", () => {
      expect(homeRedactor("/", "linux")("/etc/passwd")).toBe("/etc/passwd");
   });
});

describe("bug report form", () => {
   it("has a field for every value the app prefills", () => {
      const form = readFileSync(".github/ISSUE_TEMPLATE/bug-report.yml", "utf8");
      const url = new URL(bugReportUrl({ version: "1.0.0", system: "Windows 11 (10.0.26100) x64", archive: "logs.zip" }));
      expect(url.searchParams.get("version")).toBe("1.0.0, Windows 11 (10.0.26100) x64");
      expect(form).toContain(`name: Bug report`);
      expect(url.searchParams.get("template")).toBe("bug-report.yml");
      for (const key of [...url.searchParams.keys()].filter((key) => key !== "template")) expect(form).toMatch(new RegExp(`^\\s+id: ${key}$`, "m"));
   });
});

describe("describeSystem", () => {
   it("names Windows by build and Linux by session", () => {
      expect(describeSystem({ platform: "win32", release: "10.0.19045", arch: "x64" })).toBe("Windows 10 (10.0.19045) x64");
      expect(describeSystem({ platform: "linux", release: "6.12.1", arch: "x64", wayland: true, desktop: "Hyprland" })).toBe(
         "Linux 6.12.1 x64 Wayland (Hyprland)"
      );
      expect(describeSystem({ platform: "darwin", release: "24.1.0", arch: "arm64", macVersion: "15.1" })).toBe("macOS 15.1 arm64");
   });
});

describe("PathScrubber", () => {
   it("replaces a video's path, folder and name but keeps the extension", () => {
      const paths = new PathScrubber("linux", "/home/alex");
      paths.add("/home/alex/Videos/Trip to Oma.mkv", "video");
      expect(paths.scrub("Error opening input file /home/alex/Videos/Trip to Oma.mkv.")).toBe("Error opening input file <video>.mkv.");
      expect(paths.scrub("wrote /home/alex/Videos/.attacut-x/part.mkv and 'Trip to Oma.mkv'")).toBe(
         "wrote <video folder>/.attacut-x/part.mkv and '<video>.mkv'"
      );
   });

   it("matches Windows paths in any case and slash direction", () => {
      const paths = new PathScrubber("win32", "C:\\Users\\Alex");
      paths.add("D:\\Recordings\\Match 3.mp4", "video");
      expect(paths.scrub("d:/recordings/match 3.mp4 and D:\\Recordings\\x.mp4")).toBe("<video>.mp4 and <video folder>\\x.mp4");
   });

   it("leaves the home folder and short names to other rules", () => {
      const paths = new PathScrubber("linux", "/home/alex");
      paths.add("/home/alex/a.mp4", "video");
      expect(paths.scrub("/home/alex/.config/AttaCut and a.mp4 in data.mp4")).toBe("/home/alex/.config/AttaCut and a.mp4 in data.mp4");
      expect(paths.scrub("open /home/alex/a.mp4")).toBe("open <video>.mp4");
      paths.add("/media/clip.mp4", "video");
      expect(paths.scrub("myclip.mp4 then clip.mp4")).toBe("myclip.mp4 then <video>.mp4");
   });

   it("scrubs before a line reaches the log", async () => {
      const directory = await folder();
      const log = new AppLog({ directory, version: "1.0.0" });
      log.paths.add("/srv/media/secret-name.mov", "video");
      log.log("ffmpeg: /srv/media/secret-name.mov: Invalid data");
      await log.flush();
      const text = await readFile(join(directory, "app.log"), "utf8");
      expect(text).toContain("ffmpeg: <video>.mov: Invalid data");
      expect(text).not.toContain("secret-name");
   });
});
