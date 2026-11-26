import { expect, it } from "vitest";
import { mountType } from "./file-system";

it("reads the file system of the deepest mount holding a folder", () => {
   const mounts = [
      "/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)",
      "/dev/disk4s1 on /Volumes/NO NAME (msdos, local, nodev, nosuid, noowners)",
      "/dev/disk5s1 on /Volumes/NO NAME 2 (exfat, local, nodev, nosuid, noowners)",
   ].join("\n");
   expect(mountType("/Volumes/NO NAME/Clips", mounts)).toBe("msdos");
   expect(mountType("/Volumes/NO NAME 2/Clips", mounts)).toBe("exfat");
   expect(mountType("/Users/alex/Movies", mounts)).toBe("apfs");
});
