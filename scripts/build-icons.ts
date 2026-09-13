import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import pngToIco from "png-to-ico";
import { faScissors } from "@fortawesome/free-solid-svg-icons";

await mkdir("build", { recursive: true });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect x="8" y="8" width="240" height="240" rx="54" fill="#20262d"/><path transform="translate(58 58) scale(.2734)" fill="#9bc9f0" d="${faScissors.icon[4]}"/></svg>`;
const png = await sharp(Buffer.from(svg)).resize(1024, 1024).png().toBuffer();
await writeFile("build/icon.png", png);
await writeFile("build/icon.ico", await pngToIco(await sharp(png).resize(256, 256).toBuffer()));
// ICNS supports a 1024px PNG in its ic10 element.
const element = Buffer.alloc(8);
element.write("ic10");
element.writeUInt32BE(png.length + 8, 4);
const header = Buffer.alloc(8);
header.write("icns");
header.writeUInt32BE(png.length + 16, 4);
await writeFile("build/icon.icns", Buffer.concat([header, element, png]));
console.log("Generated app icons.");
