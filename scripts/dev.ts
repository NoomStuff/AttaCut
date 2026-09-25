// Dev launcher. Shows a tiny native splash window before Electron starts, then runs
// electron-vite; the app closes the splash once its own window has painted. Electron
// cannot draw anything during its own boot, so this window has to come from a process
// that starts faster than Electron does.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const splashFolder = join(root, "work", "splash");
const splashSource = join(root, "scripts", "splash", "attacut-splash.cs");
const splashExe = join(splashFolder, "attacut-splash.exe");
const iconPath = join(root, "build", "icon.png");
const signalPath = join(splashFolder, "signal.txt");

const frameworkCsc = ["C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe", "C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe"].find((path) =>
   existsSync(path)
);

function run(command: string, args: string[]): Promise<boolean> {
   return new Promise((resolveExit) => {
      const child = spawn(command, args, { stdio: "inherit" });
      child.on("exit", (code) => resolveExit(code === 0));
      child.on("error", () => resolveExit(false));
   });
}

// Compiles the splash helper once and caches it; returns null when the platform has no
// .NET Framework compiler or the compile fails, in which case dev simply runs splashless.
async function compileSplash(): Promise<string | null> {
   if (process.platform !== "win32" || !frameworkCsc) return null;
   await mkdir(splashFolder, { recursive: true });
   const signature = createHash("sha1")
      .update(await readFile(splashSource))
      .digest("hex");
   const cachePath = join(splashFolder, ".built-hash");
   const cached = existsSync(splashExe) && (await readFile(cachePath, "utf8").catch(() => null)) === signature;
   if (!cached) {
      const built = await run(frameworkCsc, [
         "/nologo",
         "/target:winexe",
         `/out:${splashExe}`,
         "/r:System.Windows.Forms.dll",
         "/r:System.Drawing.dll",
         splashSource,
      ]);
      if (!built) return null;
      await writeFile(cachePath, signature);
   }
   return splashExe;
}

const helperExe = await compileSplash();
let helper: ChildProcess | null = null;
try {
   if (helperExe) {
      await rm(signalPath, { force: true });
      helper = spawn(helperExe, [iconPath, signalPath], { stdio: "ignore" });
      helper.on("error", () => {
         helper = null;
      });
   }
   const electron = spawn("bunx", ["electron-vite", "dev"], {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: helper ? { ...process.env, ATTACUT_SPLASH_SIGNAL: signalPath } : process.env,
   });
   const exitCode: Promise<number | null> = new Promise((resolveExit) => {
      electron.on("exit", (code) => resolveExit(code));
      electron.on("error", () => resolveExit(1));
   });
   process.exitCode = (await exitCode) ?? 0;
} finally {
   // Close the splash however the run ends so a crashed dev server cannot strand it.
   await writeFile(signalPath, "1").catch(() => undefined);
   helper?.kill();
}
