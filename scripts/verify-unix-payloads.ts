import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { createRequire } from "node:module";
import { sha256 } from "./ci-candidate";
import { version } from "../package.json";

const inventoryPath = "work/ci/unix-payloads.json";
const inventorySchema = z.record(z.string(), z.record(z.string(), z.string()));

export async function payloadFiles(root: string): Promise<Record<string, string>> {
   const files: Record<string, string> = {};
   const visit = async (relative: string): Promise<void> => {
      const path = join(root, relative);
      const info = await lstat(path);
      if (info.isSymbolicLink()) files[relative] = `link:${await readlink(path)}`;
      else if (info.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(relative ? `${relative}/${name}` : name);
      else if (info.isFile()) files[relative] = `${info.mode & 0o111}:${await sha256(path)}`;
      else throw new Error(`Unexpected payload file type: ${path}`);
   };
   await visit("");
   return files;
}

export function comparePayload(expected: Record<string, string>, actual: Record<string, string>, complete = true): void {
   if (complete && Object.keys(expected).length !== Object.keys(actual).length) throw new Error("Package payload file list differs.");
   for (const [path, hash] of Object.entries(expected)) if (actual[path] !== hash) throw new Error(`Final package payload differs: ${path}`);
}

// Build records every final-package file, including wrapper metadata and injected
// libraries. Verification compares the complete inventory, with no ignored paths,
// and independently binds the final package's runtime to the retained tested app.
export async function verifyUnixPayloads(record = false): Promise<void> {
   if (process.platform !== "linux" && process.platform !== "darwin") return;
   await mkdir("work/ci", { recursive: true });
   const root = await mkdtemp(resolve("work/ci/payload-"));
   const inventories: Record<string, Record<string, string>> = {};
   const retain = async (format: string, expectedRoot: string, actualRoot: string, complete: boolean): Promise<void> => {
      const expected = await payloadFiles(expectedRoot);
      const actual = await payloadFiles(actualRoot);
      comparePayload(expected, actual, complete);
      inventories[format] = actual;
   };
   try {
      if (process.platform === "darwin") {
         const expected = resolve(`release/mac${process.arch === "arm64" ? "-arm64" : ""}/AttaCut.app`);
         const zip = join(root, "zip");
         execFileSync("ditto", ["-x", "-k", resolve(`release/AttaCut-${version}-mac-${process.arch}.zip`), zip], { stdio: "pipe" });
         await retain("zip", expected, join(zip, "AttaCut.app"), true);
         const mount = join(root, "dmg");
         await mkdir(mount);
         execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, resolve(`release/AttaCut-${version}-mac-${process.arch}.dmg`)], {
            stdio: "pipe",
         });
         try {
            await retain("dmg", expected, join(mount, "AttaCut.app"), true);
         } finally {
            execFileSync("hdiutil", ["detach", mount], { stdio: "pipe" });
         }
      } else {
         const image = resolve(`release/AttaCut-${version}-linux-${process.arch === "x64" ? "x86_64" : process.arch}.AppImage`);
         execFileSync(image, ["--appimage-extract"], { cwd: root, stdio: "pipe", maxBuffer: 32 * 1024 * 1024 });
         const actual = join(root, "squashfs-root");
         await retain("appimage", resolve(`release/linux${process.arch === "arm64" ? "-arm64" : ""}-unpacked`), actual, false);
         if (process.arch === "x64") {
            // Keep this narrow adapter independent of unrelated builder option
            // declarations, which include optional platform toolchain packages.
            const require = createRequire(import.meta.url);
            const { getAppImageTools } = require("app-builder-lib/out/toolsets/linux") as {
               getAppImageTools: (version: string, architecture: number) => Promise<{ runtimeLibraries: string }>;
            };
            const { Arch } = require("builder-util") as { Arch: { x64: number } };
            // package.json uses the default, checksum-pinned FUSE2 toolset.
            const { runtimeLibraries } = await getAppImageTools("0.0.0", Arch.x64);
            comparePayload(await payloadFiles(runtimeLibraries), await payloadFiles(join(actual, "usr/lib")));
         }
      }
      if (record) await writeFile(inventoryPath, JSON.stringify(inventories));
      else {
         let saved: unknown;
         try {
            saved = JSON.parse(await readFile(inventoryPath, "utf8"));
         } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT" || process.env["CANDIDATE_SHA"]) throw error;
         }
         if (saved) {
            const expected = inventorySchema.parse(saved);
            if (Object.keys(expected).length !== Object.keys(inventories).length) throw new Error("Final package format list differs.");
            for (const [format, files] of Object.entries(expected)) comparePayload(files, inventories[format] ?? {});
         }
      }
      console.log("Final Unix package payloads match the retained app, links, executable bits and package inventory.");
   } finally {
      await rm(root, { recursive: true, force: true });
   }
}
