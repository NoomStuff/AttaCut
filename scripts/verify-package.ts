import { spawn, execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { resolve, join, sep } from "node:path";
import { canReuseMediaVerification } from "./media-verification";

const [receiptFlag, receipt, ...extra] = process.argv.slice(2);
if (receiptFlag && (receiptFlag !== "--media-receipt" || !receipt || extra.length)) throw new Error("Usage: verify-package.ts [--media-receipt <path>]");

const base =
   process.platform === "win32"
      ? "release/win-unpacked"
      : process.platform === "darwin"
        ? `release/mac${process.arch === "arm64" ? "-arm64" : ""}/AttaCut.app/Contents`
        : `release/linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked`;
// On Windows the product exe is the native splash launcher; the tests attach to Electron itself.
const hasLauncher = process.platform === "win32" && existsSync(resolve(base, "AttaCut-app.exe"));
const executable = resolve(
   base,
   process.platform === "win32" ? (hasLauncher ? "AttaCut-app.exe" : "AttaCut.exe") : process.platform === "darwin" ? "MacOS/AttaCut" : "attacut"
);
const resources = resolve(base, process.platform === "darwin" ? "Resources" : "resources", "media");
const extension = process.platform === "win32" ? ".exe" : "";
if (!existsSync(executable)) throw new Error(`Packaged app missing: ${executable}`);
if (process.platform === "win32") {
   // Check both processes. The launcher can look correct while the runtime still says Electron.
   for (const file of new Set([executable, resolve(base, "AttaCut.exe")])) {
      const metadata = JSON.parse(
         execFileSync(
            "powershell",
            [
               "-NoProfile",
               "-Command",
               `$v = (Get-Item -LiteralPath '${file.replaceAll("'", "''")}').VersionInfo; $v | Select-Object FileDescription,ProductName,CompanyName,InternalName,OriginalFilename | ConvertTo-Json -Compress`,
            ],
            { encoding: "utf8", windowsHide: true }
         )
      ) as Record<string, string>;
      if (
         metadata["FileDescription"] !== "AttaCut" ||
         metadata["ProductName"] !== "AttaCut" ||
         Object.values(metadata).some((value) => /electron/i.test(value))
      ) {
         throw new Error(`Unbranded Windows executable: ${file}: ${JSON.stringify(metadata)}`);
      }
   }
}

// The splash launcher fronts the real exe for users, and no Playwright spec drives it
// (Electron tooling cannot attach through it), so its chain gets a direct smoke here:
// product exe starts, an app window appears, the launcher exits with the app's code.
async function smokeLauncher(): Promise<void> {
   const run = promisify(execFile);
   const launcher = resolve(base, "AttaCut.exe");
   if (!existsSync(launcher)) throw new Error(`Splash launcher missing: ${launcher}`);
   const profile = mkdtempSync(join(tmpdir(), "attacut-launcher-"));
   if (!resolve(profile).startsWith(resolve(tmpdir()) + sep)) throw new Error("Refusing to remove a profile outside the temp directory");
   const child = spawn(launcher, [], {
      cwd: base,
      env: { ...process.env, ATTACUT_TESTING: "1", ATTACUT_TEST_INACTIVE: "1", ATTACUT_HIDDEN: "0", ATTACUT_OPEN_FILE: "", ATTACUT_USER_DATA: profile },
      stdio: "ignore",
      windowsHide: true,
   });
   if (!child.pid) throw new Error("Launcher smoke failed: could not start the launcher");
   // Only inspect and close the runtime started by this launcher. An unrelated
   // AttaCut window on the user's desktop must never satisfy or be closed by this test.
   const ownedRuntime = `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${child.pid} AND Name = 'AttaCut-app.exe'"`;
   let runtimePid: number | null = null;
   const exited = new Promise<number>((resolveExit, reject) => {
      child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
      child.once("error", reject);
   });
   try {
      const deadline = Date.now() + 30_000;
      let visible = false;
      while (Date.now() < deadline && !visible) {
         const { stdout } = await run(
            "powershell",
            [
               "-NoProfile",
               "-Command",
               `${ownedRuntime} | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowTitle } | Select-Object -ExpandProperty Id`,
            ],
            { windowsHide: true }
         );
         runtimePid = Number(stdout.trim()) || null;
         visible = runtimePid !== null;
         if (!visible) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (!visible) throw new Error("Launcher smoke failed: no app window appeared within 30s");
      await run(
         "powershell",
         ["-NoProfile", "-Command", `Get-Process -Id ${runtimePid} -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() } | Out-Null`],
         { windowsHide: true }
      );
      const code = await Promise.race([exited, new Promise<number>((resolveExit) => setTimeout(() => resolveExit(-1), 15_000))]);
      if (code !== 0) throw new Error(`Launcher smoke failed: exited with ${code}`);
   } finally {
      await run(
         "powershell",
         ["-NoProfile", "-Command", `${ownedRuntime} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
         { windowsHide: true }
      );
      if (child.exitCode === null) child.kill();
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
   }
}

const env = {
   ...process.env,
   FFMPEG_PATH: join(resources, `ffmpeg${extension}`),
   FFPROBE_PATH: join(resources, `ffprobe${extension}`),
   ATTACUT_EXECUTABLE: executable,
};
if (hasLauncher) await smokeLauncher();
const reusable = receipt ? await canReuseMediaVerification(receipt, process.cwd(), env.FFMPEG_PATH, env.FFPROBE_PATH) : false;
if (reusable) console.log("Identical source, dependencies and media tools already passed the full suite. Running bundled-media smoke and packaged UI.");
else console.log("Running the full bundled-media suite.");
execFileSync(process.execPath, reusable ? ["tests/media/packaged-smoke.ts"] : ["run", "test:media"], { stdio: "inherit", env });
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
