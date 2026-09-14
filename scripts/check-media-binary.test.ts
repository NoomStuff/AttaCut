import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { checkMediaBinary } from "./check-media-binary.ts";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const exec = vi.mocked(execFileSync);

afterEach(() => {
   vi.unstubAllGlobals();
   vi.resetAllMocks();
});

function host(platform: string, arch = "x64"): void {
   vi.stubGlobal("process", { ...process, platform, arch });
}

describe("portable media binaries", () => {
   it("accepts static Linux binaries", () => {
      host("linux");
      exec.mockReturnValueOnce("ELF 64-bit LSB executable, x86-64").mockReturnValueOnce("There is no dynamic section in this file.");
      expect(() => checkMediaBinary("/ffmpeg")).not.toThrow();
   });

   it.each([
      "libc.so.6",
      "libm.so.6",
      "libmvec.so.1",
      "libdl.so.2",
      "librt.so.1",
      "libpthread.so.0",
      "libgcc_s.so.1",
      "ld-linux-x86-64.so.2",
      "ld-linux-aarch64.so.1",
   ])("accepts Linux system library %s", (library) => {
      host("linux");
      exec.mockReturnValueOnce("ELF 64-bit LSB executable, x86-64").mockReturnValueOnce(`0x01 (NEEDED) Shared library: [${library}]`);
      expect(() => checkMediaBinary("/ffmpeg")).not.toThrow();
   });

   it.each(["libavcodec.so", "libx264.so.164", "libstdc++.so.6", "/opt/lib/libc.so.6"])("rejects Linux non-system dependency %s", (library) => {
      host("linux");
      exec
         .mockReturnValueOnce("ELF 64-bit LSB executable, x86-64")
         .mockReturnValueOnce(`0x01 (NEEDED) Shared library: [libc.so.6]\n0x01 (NEEDED) Shared library: [${library}]`);
      expect(() => checkMediaBinary("/ffmpeg")).toThrow("static Linux builds");
   });

   it("accepts macOS system libraries", () => {
      host("darwin", "arm64");
      exec
         .mockReturnValueOnce("Mach-O 64-bit executable arm64")
         .mockReturnValueOnce(
            "/ffmpeg:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0)"
         );
      expect(() => checkMediaBinary("/ffmpeg")).not.toThrow();
   });

   it.each(["/opt/homebrew/lib/libavcodec.dylib", "@rpath/libavcodec.dylib", "@executable_path/libavcodec.dylib"])(
      "rejects macOS dependency %s",
      (dependency) => {
         host("darwin");
         exec.mockReturnValueOnce("Mach-O 64-bit executable x86_64").mockReturnValueOnce(`/ffmpeg:\n\t${dependency} (compatibility version 1.0.0)`);
         expect(() => checkMediaBinary("/ffmpeg")).toThrow("standalone macOS");
      }
   );

   it.each(["Mach-O 64-bit executable x86_64", "ELF 64-bit LSB executable, ARM aarch64"])("rejects a mismatched binary: %s", (description) => {
      host("linux");
      exec.mockReturnValueOnce(description);
      expect(() => checkMediaBinary("/ffmpeg")).toThrow("linux x64 executable");
   });
});
