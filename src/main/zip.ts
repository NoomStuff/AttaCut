import { crc32, deflateRawSync } from "node:zlib";

export interface ZipEntry {
   /** Forward slashes only; folders are implied by the path. */
   name: string;
   data: Buffer | string;
   modified?: Date;
}

/** MS-DOS timestamps: two-second resolution, years 1980 to 2107. */
function dosTime(date: Date): { time: number; date: number } {
   const year = Math.min(2107, Math.max(1980, date.getFullYear()));
   return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
   };
}

/**
 * Builds a deflated ZIP archive in memory. Log exports are a few megabytes, so this avoids a
 * dependency for a format every operating system opens natively. No ZIP64: entries and the
 * archive must stay under 4 GiB, which the callers' size caps guarantee.
 */
export function createZip(entries: ZipEntry[]): Buffer {
   const locals: Buffer[] = [];
   const central: Buffer[] = [];
   let offset = 0;
   for (const entry of entries) {
      if (!entry.name || entry.name.startsWith("/") || entry.name.includes("\\") || entry.name.split("/").includes(".."))
         throw new Error(`Invalid archive path: ${entry.name}`);
      const name = Buffer.from(entry.name, "utf8");
      const raw = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data;
      const compressed = deflateRawSync(raw, { level: 6 });
      // Store incompressible data as-is.
      const deflated = compressed.length < raw.length;
      const body = deflated ? compressed : raw;
      const checksum = crc32(raw);
      const stamp = dosTime(entry.modified ?? new Date());
      if (raw.length >= 0xffffffff || offset >= 0xffffffff) throw new Error("The archive is too large.");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version needed
      local.writeUInt16LE(0x0800, 6); // UTF-8 names
      local.writeUInt16LE(deflated ? 8 : 0, 8);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(checksum, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4); // version made by
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8);
      header.writeUInt16LE(deflated ? 8 : 0, 10);
      header.writeUInt16LE(stamp.time, 12);
      header.writeUInt16LE(stamp.date, 14);
      header.writeUInt32LE(checksum, 16);
      header.writeUInt32LE(body.length, 20);
      header.writeUInt32LE(raw.length, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt32LE(offset, 42);
      locals.push(local, name, body);
      central.push(header, name);
      offset += local.length + name.length + body.length;
   }
   const directory = Buffer.concat(central);
   const end = Buffer.alloc(22);
   end.writeUInt32LE(0x06054b50, 0);
   end.writeUInt16LE(entries.length, 8);
   end.writeUInt16LE(entries.length, 10);
   end.writeUInt32LE(directory.length, 12);
   end.writeUInt32LE(offset, 16);
   return Buffer.concat([...locals, directory, end]);
}
