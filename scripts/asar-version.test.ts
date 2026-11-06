import { createPackage, extractFile, listPackage } from "@electron/asar";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { asarVersion, setAsarVersion } from "./asar-version";

const folders: string[] = [];
afterEach(async () => {
   for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

it("changes only the app version inside a packaged archive", async () => {
   const root = await mkdtemp(join(tmpdir(), "attacut-asar-"));
   folders.push(root);
   const source = join(root, "app");
   await mkdir(join(source, "out"), { recursive: true });
   await writeFile(join(source, "package.json"), JSON.stringify({ name: "attacut", version: "1.2.3", main: "out/main.js" }));
   await writeFile(join(source, "out", "main.js"), "console.log('unchanged')");
   const archive = join(root, "app.asar");
   await createPackage(source, archive);
   await setAsarVersion(archive, "1.2.40");
   expect(await asarVersion(archive)).toBe("1.2.40");
   expect(JSON.parse(extractFile(archive, "package.json").toString())).toEqual({ name: "attacut", version: "1.2.40", main: "out/main.js" });
   expect(extractFile(archive, "out/main.js").toString()).toBe("console.log('unchanged')");
   expect(
      listPackage(archive, { isPack: false })
         .map((path) => path.replaceAll("\\", "/"))
         .sort()
   ).toEqual(["/out", "/out/main.js", "/package.json"]);
});
