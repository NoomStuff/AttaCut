import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip";
import { version } from "../package.json";

async function hash(path: string): Promise<string> {
   const digest = createHash("sha256");
   for await (const chunk of createReadStream(path)) digest.update(chunk);
   return digest.digest("hex");
}
async function files(root: string): Promise<string[]> {
   const found: string[] = [];
   for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Unexpected payload link: ${entry.name}`);
      if (entry.isDirectory()) for (const child of await files(join(root, entry.name))) found.push(`${entry.name}/${child}`);
      else if (entry.isFile()) found.push(entry.name);
   }
   return found.sort();
}
export async function verifyWindowsPayloads(): Promise<void> {
   if (process.platform !== "win32") return;
   const sevenZip = await getPath7za();
   const unpacked = resolve("release/win-unpacked");
   const expected = await files(unpacked);
   const manifest = new Map(await Promise.all(expected.map(async (name) => [name, await hash(join(unpacked, name))] as const)));
   for (const suffix of [".exe", "-Installer.exe"]) {
      const artifact = resolve(`release/AttaCut-${version}-win-${process.arch}${suffix}`);
      const temporary = await mkdtemp(resolve("work/payload-"));
      try {
         const extract = (archive: string, destination: string) =>
            execFileSync(sevenZip, ["x", "-y", `-o${destination}`, archive], { stdio: "pipe", windowsHide: true });
         extract(artifact, temporary);
         // NSIS stores its app archive in $PLUGINSDIR. Verify the final EXE,
         // rather than trusting the intermediate app archive left by builder.
         for (const archive of (await files(temporary)).filter((name) => /app-.*\.7z$/.test(name)))
            extract(join(temporary, archive), join(temporary, "app-payload"));
         const candidates = (await files(temporary)).filter((name) => name.endsWith("resources/app.asar"));
         if (candidates.length !== 1) throw new Error(`${artifact} must contain exactly one app payload.`);
         const root = dirname(dirname(join(temporary, candidates[0]!)));
         const actual = await files(root);
         if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${artifact} payload file list differs from verified unpacked app.`);
         for (const name of expected) if ((await hash(join(root, name))) !== manifest.get(name)) throw new Error(`${artifact} payload differs: ${name}`);
         console.log(`Final Windows payload matches verified unpacked app: ${artifact}`);
      } finally {
         await rm(temporary, { recursive: true, force: true });
      }
   }
}
