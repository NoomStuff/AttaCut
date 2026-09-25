import { mkdir, writeFile, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { faScissors } from "@fortawesome/free-solid-svg-icons";

await mkdir("build", { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="54" fill="#20262d"/><path transform="translate(58 58) scale(.2734)" fill="#9bc9f0" d="${faScissors.icon[4]}"/></svg>`;
// Shown behind the portable stub while it extracts; must be a BMP for NSIS BgImage.
// The Loading text stands in for the spinner at its exact rect (the static card cannot
// animate one), so the native splash hands over in place when the real spinner takes over.
const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="216" height="148"><rect width="216" height="148" fill="#17191c"/><g transform="translate(76 22)"><rect width="64" height="64" rx="13.5" fill="#20262d"/><path transform="translate(14.5 14.5) scale(.06835)" fill="#9bc9f0" d="${faScissors.icon[4]}"/></g><text x="108" y="123" text-anchor="middle" font-family="Segoe UI" font-size="11" fill="#969da7">Loading...</text></svg>`;
// Icon generation costs about half a second; dev runs skip it until the inputs change.
const signature = createHash("sha1").update(svg).update(splashSvg).digest("hex");
const outputs = await Promise.all(["build/icon.png", "build/icon.ico", "build/icon.icns", "build/splash.bmp"].map((path) => stat(path).catch(() => null)));
const cached = outputs.every(Boolean) ? await readFile("build/.icons-cache", "utf8").catch(() => null) : null;
if (cached === signature) {
   console.log("App icons are up to date.");
   process.exit(0);
}
const png = await sharp(Buffer.from(svg)).resize(1024, 1024).png().toBuffer();
await writeFile("build/icon.png", png);
await writeFile("build/icon.ico", await pngToIco(await sharp(png).resize(256, 256).toBuffer()));
// BMPs are bottom-up 24-bit BGR with rows padded to 4 bytes; sharp cannot emit them.
const width = 216;
const height = 148;
const raw = await sharp(Buffer.from(splashSvg)).flatten().raw().toBuffer();
const channel = (index: number): number => raw[index] ?? 0;
const rowSize = Math.ceil((width * 3) / 4) * 4;
const pixels = Buffer.alloc(rowSize * height);
for (let y = 0; y < height; y++) {
   const source = (height - 1 - y) * width * 3;
   const target = y * rowSize;
   for (let x = 0; x < width; x++) {
      pixels[target + x * 3] = channel(source + x * 3 + 2);
      pixels[target + x * 3 + 1] = channel(source + x * 3 + 1);
      pixels[target + x * 3 + 2] = channel(source + x * 3);
   }
}
const bmpHeader = Buffer.alloc(54);
bmpHeader.write("BM", 0);
bmpHeader.writeUInt32LE(54 + pixels.length, 2);
bmpHeader.writeUInt32LE(54, 10);
bmpHeader.writeUInt32LE(40, 14);
bmpHeader.writeInt32LE(width, 18);
bmpHeader.writeInt32LE(height, 22);
bmpHeader.writeUInt16LE(1, 26);
bmpHeader.writeUInt16LE(24, 28);
bmpHeader.writeUInt32LE(pixels.length, 34);
await writeFile("build/splash.bmp", Buffer.concat([bmpHeader, pixels]));
// ICNS supports a 1024px PNG in its ic10 element.
const element = Buffer.alloc(8);
element.write("ic10");
element.writeUInt32BE(png.length + 8, 4);
const header = Buffer.alloc(8);
header.write("icns");
header.writeUInt32BE(png.length + 16, 4);
await writeFile("build/icon.icns", Buffer.concat([header, element, png]));
await writeFile("build/.icons-cache", signature);
console.log("Generated app icons.");
