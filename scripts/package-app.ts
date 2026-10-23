import { execFileSync } from "node:child_process";

export interface PackageOptions {
   mode: "dist" | "package";
   platform?: NodeJS.Platform;
   flavor?: "portable" | "installer" | "all";
   /** Release verification already built and tested this checkout in the same process. */
   build?: boolean;
   env?: NodeJS.ProcessEnv;
}

export function packageApp({ mode, platform = process.platform, flavor = "portable", build = true, env = process.env }: PackageOptions): void {
   if (platform !== "win32" && platform !== "darwin" && platform !== "linux") throw new Error(`Unsupported platform: ${platform}`);
   if (platform === "linux" && flavor !== "portable") throw new Error(`${flavor} is not available on Linux.`);
   if (platform !== process.platform) {
      throw new Error(`Build ${platform} on a ${platform} machine. FFmpeg and Electron must match the build host.`);
   }
   if (process.arch !== "x64" && process.arch !== "arm64") throw new Error(`Unsupported architecture: ${process.arch}`);
   const run = (args: string[]): void => {
      execFileSync(process.execPath, args, { stdio: "inherit", env, windowsHide: true });
   };
   if (build) run(["run", "build"]);
   run(["run", "bundle:media"]);
   const target =
      platform === "win32"
         ? flavor === "installer"
            ? ["nsis"]
            : flavor === "all"
              ? ["portable", "nsis"]
              : ["portable"]
         : platform === "darwin"
           ? flavor === "installer"
              ? ["dmg"]
              : flavor === "all"
                ? ["zip", "dmg"]
                : ["zip"]
           : ["AppImage"];
   run([
      "x",
      "--no-install",
      "electron-builder",
      platform === "darwin" ? "--mac" : platform === "win32" ? "--win" : "--linux",
      ...(mode === "dist" ? target : []),
      `--${process.arch}`,
      "--publish=never",
      ...(mode === "package" ? ["--dir"] : []),
   ]);
}

if (import.meta.main) {
   const [mode, platform = process.platform, flavor = "portable", ...extra] = process.argv.slice(2);
   if (
      (mode !== "dist" && mode !== "package") ||
      extra.length ||
      (platform !== "win32" && platform !== "darwin" && platform !== "linux") ||
      (flavor !== "portable" && flavor !== "installer" && flavor !== "all")
   )
      throw new Error("Usage: bun scripts/package-app.ts <dist|package> [win32|darwin|linux] [portable|installer|all]");
   packageApp({ mode, platform, flavor });
}
