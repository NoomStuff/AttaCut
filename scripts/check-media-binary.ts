import { execFileSync } from "node:child_process";

// Unix bundles must not depend on Homebrew or build-machine codec libraries.
export function checkMediaBinary(source: string): void {
   if (process.platform === "win32") return;
   const description = execFileSync("file", ["-b", source], { encoding: "utf8" });
   const architecture = process.arch === "arm64" ? /arm64|aarch64/i : /x86[_-]64/i;
   const format = process.platform === "darwin" ? /Mach-O/ : /ELF/;
   if (!format.test(description) || !architecture.test(description)) {
      throw new Error(`${source} must be a ${process.platform} ${process.arch} executable. Found: ${description.trim()}`);
   }
   if (process.platform === "linux") {
      const dynamic = execFileSync("readelf", ["-d", source], { encoding: "utf8" });
      // Static codec builds still link to the Linux C runtime and GCC support library.
      const systemLibrary = /^(?:lib(?:c|m|mvec|dl|rt|pthread|resolv|util)\.so\.\d+|libgcc_s\.so\.1|ld-linux(?:-x86-64|-aarch64)?\.so\.[12])$/;
      const external = dynamic.split(/\r?\n/).filter((line) => {
         if (!/\(NEEDED\)/.test(line)) return false;
         const library = /\[([^\]]+)\]/.exec(line)?.[1];
         return !library || !systemLibrary.test(library);
      });
      if (external.length > 0) {
         throw new Error(`${source} uses non-system shared libraries. Use static Linux builds. Dependencies: ${external.join(", ")}`);
      }
   } else {
      const dependencies = execFileSync("otool", ["-L", source], { encoding: "utf8" });
      const external = dependencies.split(/\r?\n/).filter((line) => /^\s+\S/.test(line) && !/^\s+\/(usr\/lib|System\/Library)\//.test(line));
      if (external.length > 0) {
         throw new Error(`${source} uses non-system libraries. Use a standalone macOS FFmpeg build. Dependencies: ${external.join(", ")}`);
      }
   }
}
