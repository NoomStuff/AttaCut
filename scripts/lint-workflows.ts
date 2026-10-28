import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "./ci-candidate";

const version = "1.7.12";
const distributions: Record<string, { file: string; sha256: string }> = {
   "win32-x64": { file: `actionlint_${version}_windows_amd64.zip`, sha256: "6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9" },
   "linux-x64": { file: `actionlint_${version}_linux_amd64.tar.gz`, sha256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8" },
   "darwin-x64": { file: `actionlint_${version}_darwin_amd64.tar.gz`, sha256: "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644" },
   "darwin-arm64": { file: `actionlint_${version}_darwin_arm64.tar.gz`, sha256: "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f" },
};
const distribution = distributions[`${process.platform}-${process.arch}`];
if (!distribution) throw new Error("No pinned actionlint distribution for this host.");
const directory = resolve("work/actionlint");
await mkdir(directory, { recursive: true });
const archive = resolve(directory, distribution.file);
execFileSync(
   process.platform === "win32" ? "curl.exe" : "curl",
   [
      "--fail",
      "--location",
      "--silent",
      "--show-error",
      "--retry",
      "3",
      "--retry-max-time",
      "120",
      "--connect-timeout",
      "15",
      "--max-time",
      "120",
      "--output",
      archive,
      `https://github.com/rhysd/actionlint/releases/download/v${version}/${distribution.file}`,
   ],
   { stdio: "inherit", timeout: 180_000 }
);
if ((await sha256(archive)) !== distribution.sha256) throw new Error("Actionlint checksum mismatch.");
execFileSync("tar", ["-xf", archive, "-C", directory], { stdio: "inherit" });
execFileSync(resolve(directory, process.platform === "win32" ? "actionlint.exe" : "actionlint"), ["-shellcheck=", "-pyflakes="], { stdio: "inherit" });
