import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

interface Entry {
   size: number;
   offset: string;
   integrity?: { algorithm: string; hash: string; blockSize: number; blocks: string[] };
}

/**
 * Give a packaged app a different version without rebuilding it: the update test needs an
 * older and a newer copy of the exact candidate. The replacement package.json is appended
 * and the header points at it, so every other file keeps its bytes and offset.
 */
export async function setAsarVersion(archive: string, version: string): Promise<void> {
   const bytes = await readFile(archive);
   const headerSize = bytes.readUInt32LE(4);
   const header = bytes.subarray(8, 8 + headerSize);
   const length = header.readInt32LE(4);
   const tree = JSON.parse(header.subarray(8, 8 + length).toString("utf8")) as { files: Record<string, Entry> };
   const entry = tree.files["package.json"];
   if (!entry || typeof entry.offset !== "string") throw new Error("The packaged app has no package.json.");
   const contentStart = 8 + headerSize;
   const start = contentStart + Number(entry.offset);
   const manifest = JSON.parse(bytes.subarray(start, start + entry.size).toString("utf8")) as { version: string };
   manifest.version = version;
   const content = Buffer.from(JSON.stringify(manifest, null, 2));
   const hash = createHash("sha256").update(content).digest("hex");
   entry.offset = String(bytes.length - contentStart);
   entry.size = content.length;
   entry.integrity = { algorithm: "SHA256", hash, blockSize: 4 * 1024 * 1024, blocks: [hash] };
   const json = Buffer.from(JSON.stringify(tree));
   const padded = Buffer.alloc(8 + json.length + ((4 - (json.length % 4)) % 4));
   padded.writeUInt32LE(padded.length - 4, 0);
   padded.writeInt32LE(json.length, 4);
   json.copy(padded, 8);
   const size = Buffer.alloc(8);
   size.writeUInt32LE(4, 0);
   size.writeUInt32LE(padded.length, 4);
   await writeFile(archive, Buffer.concat([size, padded, bytes.subarray(contentStart), content]));
}

export async function asarVersion(archive: string): Promise<string> {
   const bytes = await readFile(archive);
   const headerSize = bytes.readUInt32LE(4);
   const length = bytes.readInt32LE(12);
   const tree = JSON.parse(bytes.subarray(16, 16 + length).toString("utf8")) as { files: Record<string, Entry> };
   const entry = tree.files["package.json"]!;
   const start = 8 + headerSize + Number(entry.offset);
   return (JSON.parse(bytes.subarray(start, start + entry.size).toString("utf8")) as { version: string }).version;
}
