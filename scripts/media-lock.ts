export interface MediaArchive {
   url: string;
   sha256: string;
}
const build = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-19-13-11/ffmpeg-n8.1.2-54-gc573a95381";
// Checksums are checked before extraction. Changing a provider's asset fails closed.
export const mediaArchives: Record<string, MediaArchive[]> = {
   "win32-x64": [{ url: `${build}-win64-gpl-8.1.zip`, sha256: "8a7bc5343c874b4645fcf0d7a2e441da23573d3eddd1f5993c10a8f1226a6889" }],
   "linux-x64": [{ url: `${build}-linux64-gpl-8.1.tar.xz`, sha256: "5c7ffcf37fd5e0ab99ee2a4a6a5e70219379ec5a4dee2ed39f891c3790a2cbb5" }],
   "linux-arm64": [{ url: `${build}-linuxarm64-gpl-8.1.tar.xz`, sha256: "f815b9aa4479ca9e3ccdd3ad828fd8a68bd8aa9dfaee0d57f9912677bce7f052" }],
   "darwin-x64": [
      { url: "https://evermeet.cx/ffmpeg/ffmpeg-9.0.2.zip", sha256: "4acc0be580f9b2788029eb7bd4d645ff87968911b0a62aeeb3940d42d54558d5" },
      { url: "https://evermeet.cx/ffmpeg/ffprobe-9.0.2.zip", sha256: "24a9c968cd4da72d99c7245e914b921815835eb6dff01d99868031aebaf1d439" },
   ],
   "darwin-arm64": [
      { url: "https://www.osxexperts.net/ffmpeg9arm.zip", sha256: "d0c06c5c68ce48af3143b262f7a9118a7c9f67de1e237fcc24ffb14df9c67af9" },
      { url: "https://www.osxexperts.net/ffprobe9arm.zip", sha256: "0c94fbdd8917022f28115eca512196cf4648732bc9e5db9ec8896c7e519d02aa" },
   ],
};
