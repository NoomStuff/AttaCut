import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const base =
   process.platform === "win32"
      ? "release/win-unpacked"
      : process.platform === "darwin"
        ? `release/mac${process.arch === "arm64" ? "-arm64" : ""}/AttaCut.app/Contents`
        : `release/linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked`;
const executable = resolve(base, process.platform === "win32" ? "AttaCut.exe" : process.platform === "darwin" ? "MacOS/AttaCut" : "attacut");
const resources = resolve(base, process.platform === "darwin" ? "Resources" : "resources", "media");
const extension = process.platform === "win32" ? ".exe" : "";
if (!existsSync(executable)) throw new Error(`Packaged app missing: ${executable}`);
const env = {
   ...process.env,
   FFMPEG_PATH: join(resources, `ffmpeg${extension}`),
   FFPROBE_PATH: join(resources, `ffprobe${extension}`),
   ATTACUT_EXECUTABLE: executable,
};
execFileSync(process.execPath, ["run", "test:media"], { stdio: "inherit", env });
const args = [
   "x",
   "--no-install",
   "playwright",
   "test",
   "--project=ui",
   "tests/ui/editor-session.spec.mjs",
   "tests/ui/export-workflow.spec.mjs",
   "tests/ui/architecture.spec.mjs",
];
if (process.platform === "linux") execFileSync("xvfb-run", ["--auto-servernum", process.execPath, ...args], { stdio: "inherit", env });
else execFileSync(process.execPath, args, { stdio: "inherit", env });
