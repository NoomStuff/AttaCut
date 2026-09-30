import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** Brand a private runtime copy so development never relabels the shared Electron binary. */
export async function windowsDevExecutable(root: string): Promise<string | undefined> {
   if (process.platform !== "win32") return undefined;
   const require = createRequire(import.meta.url);
   // Load builder's resource editor without pulling its unrelated packaging declarations
   // into the app's strict typecheck. Keep this adapter in sync with the pinned builder.
   const { editWindowsResources } = require("app-builder-lib/out/util/resEdit.js") as {
      editWindowsResources(options: {
         file: string;
         iconPath: string;
         fileVersion: string;
         productVersion: string;
         versionStrings: Record<string, string>;
      }): Promise<void>;
   };
   const original = require("electron") as string;
   const iconPath = join(root, "build", "icon.ico");
   const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string; author: string };
   const signature = createHash("sha256")
      .update(original)
      .update(await readFile(original))
      .update(await readFile(iconPath))
      .update(JSON.stringify(pkg))
      .digest("hex");
   const folder = join(root, "work", "runtime", signature);
   const executable = join(folder, "AttaCut.exe");
   const receipt = join(folder, ".branded");
   if (!existsSync(receipt)) {
      await mkdir(folder, { recursive: true });
      await cp(dirname(original), folder, { recursive: true });
      await rename(join(folder, "electron.exe"), executable);
      await editWindowsResources({
         file: executable,
         iconPath,
         fileVersion: pkg.version,
         productVersion: pkg.version,
         versionStrings: {
            FileDescription: "AttaCut",
            ProductName: "AttaCut",
            CompanyName: pkg.author,
            InternalName: "AttaCut",
            OriginalFilename: "AttaCut.exe",
            LegalCopyright: `Copyright ${pkg.author}`,
            LegalTrademarks: "",
         },
      });
      await writeFile(receipt, signature);
   }
   return executable;
}
