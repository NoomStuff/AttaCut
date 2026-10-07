import { createRequire } from "node:module";
const sharp = createRequire(import.meta.url)("sharp");

// Offscreen canvases cannot be read with getContext on the window. Inspect the
// composited pixels, avoiding the clip border, label and handles.
export async function waveformColorCount(page, from = 0.3, to = 0.7) {
   const canvas = page.locator(".clip-waveform").first();
   if (!(await canvas.count()) || !(await canvas.isVisible())) return 0;
   const { data, info } = await sharp(await canvas.screenshot())
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
   const colors = new Set();
   for (let y = 3; y < info.height - 3; y++)
      for (let x = Math.floor(info.width * from); x < info.width * to; x++) {
         const at = (y * info.width + x) * info.channels;
         colors.add(`${data[at]},${data[at + 1]},${data[at + 2]}`);
      }
   return colors.size;
}
export async function hasWaveformPixels(page) {
   return (await waveformColorCount(page)) > 5;
}
