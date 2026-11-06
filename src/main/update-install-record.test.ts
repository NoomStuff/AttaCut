import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { installRecordName, takeInstallOutcome, writeInstallRecord } from "./update-install-record";

const folders: string[] = [];
afterEach(async () => {
   for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function folder() {
   const path = await mkdtemp(join(tmpdir(), "attacut-install-record-"));
   folders.push(path);
   return path;
}

it("reports an update that did not change the running version, then clears the record", async () => {
   const directory = await folder();
   await writeInstallRecord(directory, { fromVersion: "1.0.0", targetVersion: "1.1.0" });
   expect(await takeInstallOutcome(directory, "1.0.0")).toEqual({ applied: false, targetVersion: "1.1.0" });
   expect(await readdir(directory)).toEqual([]);
   expect(await takeInstallOutcome(directory, "1.0.0")).toBeNull();
});

it("treats any version change as applied", async () => {
   const directory = await folder();
   await writeInstallRecord(directory, { fromVersion: "1.0.0", targetVersion: "1.1.0" });
   expect(await takeInstallOutcome(directory, "1.1.0")).toEqual({ applied: true, targetVersion: "1.1.0" });
   expect(await readdir(directory)).toEqual([]);
});

it("ignores and clears a damaged record", async () => {
   const directory = await folder();
   await writeFile(join(directory, installRecordName), "{not json");
   expect(await takeInstallOutcome(directory, "1.0.0")).toBeNull();
   expect(await readdir(directory)).toEqual([]);
});
