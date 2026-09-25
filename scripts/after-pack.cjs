// electron-builder afterPack hook: on Windows, the product executable becomes a tiny
// native launcher that shows the boot splash immediately and starts the real Electron
// exe (AttaCut-app.exe) beside it. The portable NSIS stub and installer shortcuts run
// the product name, so the swap is invisible to users. Other platforms keep the stock
// Electron executable and launch without a pre-boot splash.
const { execFileSync } = require("node:child_process");
const { existsSync, renameSync } = require("node:fs");
const { join } = require("node:path");

function findCsc() {
   const candidates = ["C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe", "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"];
   return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

module.exports = async function afterPack(context) {
   if (context.electronPlatformName !== "win32") return;
   const csc = findCsc();
   if (!csc) {
      console.warn("No .NET Framework compiler found; packaging without the boot splash launcher.");
      return;
   }
   const appOutDir = context.appOutDir;
   const electronExe = join(appOutDir, `${context.packager.appInfo.productFilename}.exe`);
   const renamedExe = join(appOutDir, "AttaCut-app.exe");
   const launcherExe = join(appOutDir, `${context.packager.appInfo.productFilename}.exe`);
   if (!existsSync(electronExe)) throw new Error(`Packaged executable missing: ${electronExe}`);
   renameSync(electronExe, renamedExe);
   execFileSync(
      csc,
      [
         "/nologo",
         "/target:winexe",
         `/out:${launcherExe}`,
         `/win32icon:${join(__dirname, "..", "build", "icon.ico")}`,
         "/r:System.Windows.Forms.dll",
         "/r:System.Drawing.dll",
         join(__dirname, "splash", "attacut-splash.cs"),
      ],
      { stdio: "inherit" }
   );
};
