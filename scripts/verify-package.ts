import { spawn, execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { resolve, join } from "node:path";

const base =
   process.platform === "win32"
      ? "release/win-unpacked"
      : process.platform === "darwin"
        ? `release/mac${process.arch === "arm64" ? "-arm64" : ""}/AttaCut.app/Contents`
        : `release/linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked`;
// On Windows the product exe is the native splash launcher; the tests attach to Electron itself.
const executable = resolve(base, process.platform === "win32" ? "AttaCut-app.exe" : process.platform === "darwin" ? "MacOS/AttaCut" : "attacut");
const resources = resolve(base, process.platform === "darwin" ? "Resources" : "resources", "media");
const extension = process.platform === "win32" ? ".exe" : "";
if (!existsSync(executable)) throw new Error(`Packaged app missing: ${executable}`);

// The splash launcher fronts the real exe for users, and no Playwright spec drives it
// (Electron tooling cannot attach through it), so its chain gets a direct smoke here:
// product exe starts, an app window appears, the launcher exits with the app's code.
async function smokeLauncher(): Promise<void> {
   const run = promisify(execFile);
   const launcher = resolve(base, "AttaCut.exe");
   if (!existsSync(launcher)) throw new Error(`Splash launcher missing: ${launcher}`);
   const profile = mkdtempSync(join(tmpdir(), "attacut-launcher-"));
   const child = spawn(launcher, [], { cwd: base, env: { ...process.env, ATTACUT_USER_DATA: profile }, stdio: "ignore" });
   try {
      const deadline = Date.now() + 30_000;
      let visible = false;
      while (Date.now() < deadline && !visible) {
         const { stdout } = await run("powershell", [
            "-NoProfile",
            "-Command",
            "[bool](Get-Process -Name 'AttaCut-app' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle })",
         ]);
         visible = stdout.trim() === "True";
         if (!visible) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!visible) throw new Error("Launcher smoke failed: no app window appeared within 30s");
      await run("powershell", [
         "-NoProfile",
         "-Command",
         "Get-Process -Name 'AttaCut-app' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.CloseMainWindow() } | Out-Null",
      ]);
      const code = await Promise.race([
         new Promise<number>((resolveExit) => child.on("exit", (exitCode) => resolveExit(exitCode ?? 1))),
         new Promise<number>((resolveExit) => setTimeout(() => resolveExit(-1), 15_000)),
      ]);
      if (code !== 0) throw new Error(`Launcher smoke failed: exited with ${code}`);
   } finally {
      if (child.exitCode === null) child.kill();
      rmSync(profile, { recursive: true, force: true });
   }
}

const env = {
   ...process.env,
   FFMPEG_PATH: join(resources, `ffmpeg${extension}`),
   FFPROBE_PATH: join(resources, `ffprobe${extension}`),
   ATTACUT_EXECUTABLE: executable,
};
if (process.platform === "win32") await smokeLauncher();
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
