import { describe, expect, it } from "vitest";
import { crc32, inflateRawSync } from "node:zlib";
import { createZip } from "./zip";

/** Reads entries back through the central directory, as an unzip tool does. */
function readZip(archive: Buffer): Map<string, string> {
   const end = archive.length - 22;
   expect(archive.readUInt32LE(end)).toBe(0x06054b50);
   const count = archive.readUInt16LE(end + 10);
   let cursor = archive.readUInt32LE(end + 16);
   const files = new Map<string, string>();
   for (let index = 0; index < count; index++) {
      expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
      const method = archive.readUInt16LE(cursor + 10);
      const checksum = archive.readUInt32LE(cursor + 16);
      const size = archive.readUInt32LE(cursor + 20);
      const nameLength = archive.readUInt16LE(cursor + 28);
      const offset = archive.readUInt32LE(cursor + 42);
      const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
      const localName = archive.readUInt16LE(offset + 26);
      const body = archive.subarray(offset + 30 + localName, offset + 30 + localName + size);
      const data = method === 8 ? inflateRawSync(body) : body;
      expect(crc32(data)).toBe(checksum);
      files.set(name, data.toString("utf8"));
      cursor += 46 + nameLength;
   }
   return files;
}

describe("createZip", () => {
   it("round-trips compressed and stored entries", () => {
      const log = "2026-11-10T12:00:00.000Z info capture started\n".repeat(200);
      const archive = createZip([
         { name: "logs/app.log", data: log, modified: new Date(2026, 10, 10, 12, 30, 15) },
         { name: "system.json", data: "{}" },
         { name: "notes/übung.txt", data: Buffer.from("ünïcode") },
      ]);
      const files = readZip(archive);
      expect([...files.keys()]).toEqual(["logs/app.log", "system.json", "notes/übung.txt"]);
      expect(files.get("logs/app.log")).toBe(log);
      expect(files.get("notes/übung.txt")).toBe("ünïcode");
      expect(archive.length).toBeLessThan(log.length);
   });

   it("writes an empty archive", () => {
      expect(readZip(createZip([])).size).toBe(0);
   });

   it("refuses paths that escape the archive", () => {
      for (const name of ["../x", "/abs", "a\\b", ""]) expect(() => createZip([{ name, data: "" }])).toThrow();
   });
});
