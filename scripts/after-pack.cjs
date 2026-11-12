// electron-builder afterPack hook, shared by AcroClip, AttaCut and Deduup. On Windows, the
// product executable becomes the native launcher from scripts/splash, which shows the
// splash at once and starts the real Electron executable, renamed <Product>-app.exe, beside
// it. The portable stub and installer shortcuts run the product name, so the swap is
// invisible to users. Other platforms keep the stock Electron executable.
const { execFileSync } = require("node:child_process");
const { copyFileSync, existsSync, renameSync } = require("node:fs");
const { join } = require("node:path");

function findCsc() {
   const candidates = ["C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe", "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"];
   return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

module.exports = async function afterPack(context) {
   if (context.electronPlatformName !== "win32") return;
   const csc = findCsc();
   // Release builds always run on Windows, where csc ships with the OS. A build that cannot
   // compile the launcher would ship a different exe layout, so it fails instead.
   if (!csc) throw new Error("The .NET Framework compiler is missing, so the splash launcher cannot be built.");
   const product = context.packager.appInfo.productFilename;
   const appOutDir = context.appOutDir;
   const electronExe = join(appOutDir, `${product}.exe`);
   const runtimeExe = join(appOutDir, `${product}-app.exe`);
   if (!existsSync(electronExe)) throw new Error(`Packaged executable missing: ${electronExe}`);
   renameSync(electronExe, runtimeExe);
   // afterPack runs before builder edits the product exe. The renamed runtime needs
   // its own resource pass or Task Manager and file properties keep Electron's identity.
   await context.packager.signAndEditResources(runtimeExe, context.arch, appOutDir, product);
   const splash = join(context.packager.projectDir, "scripts", "splash");
   const icon = context.packager.config.win?.icon
      ? join(context.packager.projectDir, context.packager.config.win.icon)
      : join(context.packager.projectDir, "build", "icon.ico");
   execFileSync(
      csc,
      [
         "/nologo",
         "/target:winexe",
         `/out:${electronExe}`,
         `/win32icon:${icon}`,
         "/r:System.Windows.Forms.dll",
         "/r:System.Drawing.dll",
         join(splash, "splash.cs"),
         join(splash, "identity.cs"),
      ],
      { stdio: "inherit" }
   );
   // Updates show the same splash from a temporary copy of this file, because the
   // installer replaces the launcher itself while it runs.
   copyFileSync(electronExe, join(appOutDir, "resources", "splash.exe"));
};
