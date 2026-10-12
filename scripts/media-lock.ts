export interface MediaArchive {
   url: string;
   sha256: string;
   files?: string[];
}
// Month-end builds are retained for two years; ordinary daily builds expire after 14 days.
const build = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n8.1.3-9-g29e619e767";
// Checksums are checked before extraction. Changing a provider's asset fails closed.
export const mediaArchives: Record<string, MediaArchive[]> = {
   "win32-x64": [{ url: `${build}-win64-gpl-8.1.zip`, sha256: "7b801cdd3a1a0bb54ae6f572187e68b4ed54f52086cfee133fab2180bfb429fa" }],
   "linux-x64": [{ url: `${build}-linux64-gpl-8.1.tar.xz`, sha256: "97ce978979194b5cf7e06a5e68020dbdaa7a4f3294c5452b6a1bc347100dbb79" }],
   "linux-arm64": [{ url: `${build}-linuxarm64-gpl-8.1.tar.xz`, sha256: "10523d1e0be6b3ce62a9708cc50815c4b5eb5f36ae147fbe2afeecda6f2d6845" }],
   "darwin-x64": [
      // Reuse the verified 9.0.2 binaries from our published package. The original
      // provider's download server repeatedly rate-limits GitHub runners.
      {
         url: "https://github.com/NoomStuff/AttaCut/releases/download/v0.21.3/AttaCut-0.21.3-mac-x64.zip",
         sha256: "26dbe2083da81d30929e2ff2307541e9b5080e61335e341dd57db6b528ee6f57",
         files: [
            "AttaCut.app/Contents/Resources/media/ffmpeg",
            "AttaCut.app/Contents/Resources/media/ffprobe",
            "AttaCut.app/Contents/Resources/media/provenance.json",
         ],
      },
   ],
   "darwin-arm64": [
      { url: "https://www.osxexperts.net/ffmpeg9arm.zip", sha256: "d0c06c5c68ce48af3143b262f7a9118a7c9f67de1e237fcc24ffb14df9c67af9" },
      { url: "https://www.osxexperts.net/ffprobe9arm.zip", sha256: "0c94fbdd8917022f28115eca512196cf4648732bc9e5db9ec8896c7e519d02aa" },
   ],
};
