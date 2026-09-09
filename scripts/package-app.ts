import { execFileSync } from "node:child_process";

const [mode, platform = process.platform, ...extra] = process.argv.slice(2);
if ((mode !== "dist" && mode !== "package") || extra.length > 0) {
   throw new Error("Usage: bun scripts/package-app.ts <dist|package> [win32|darwin|linux]");
}
if (platform !== "win32" && platform !== "darwin" && platform !== "linux") throw new Error(`Unsupported platform: ${platform}`);
if (platform !== process.platform) {
   throw new Error(`Build ${platform} on a ${platform} machine. FFmpeg and Electron must match the build host.`);
}
if (process.arch !== "x64" && process.arch !== "arm64") throw new Error(`Unsupported architecture: ${process.arch}`);
const run = (args: string[]): void => {
   execFileSync(process.execPath, args, { stdio: "inherit" });
};
run(["run", "build"]);
run(["run", "bundle:media"]);
run([
   "x",
   "--no-install",
   "electron-builder",
   platform === "darwin" ? "--mac" : platform === "win32" ? "--win" : "--linux",
   `--${process.arch}`,
   "--publish=never",
   ...(mode === "package" ? ["--dir"] : []),
]);
