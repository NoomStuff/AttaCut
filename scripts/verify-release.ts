import { execFileSync } from "node:child_process";
import { provisionMedia } from "./provision-media.ts";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { mediaVerificationFingerprint } from "./media-verification";

const run = (args: string[], env: NodeJS.ProcessEnv) => execFileSync(process.execPath, args, { stdio: "inherit", env });

run(["install", "--frozen-lockfile"], process.env);
const env = { ...process.env, ...(await provisionMedia()), CI: "true" };
run(["run", "verify"], env);
const fingerprint = await mediaVerificationFingerprint(process.cwd(), env.FFMPEG_PATH!, env.FFPROBE_PATH!);
run(["run", "test:media"], env);
run(["x", "--no-install", "playwright", "test"], env);
run(["run", process.platform === "win32" ? "dist:win:all" : process.platform === "darwin" ? "dist:mac:all" : "dist"], {
   ...env,
   CSC_IDENTITY_AUTO_DISCOVERY: "false",
});
await mkdir("work", { recursive: true });
const receiptFolder = await mkdtemp(resolve("work/media-verification-"));
try {
   const receipt = join(receiptFolder, "receipt.json");
   await writeFile(receipt, JSON.stringify({ version: 1, fingerprint }));
   run(["scripts/verify-package.ts", "--media-receipt", receipt], env);
} finally {
   await rm(receiptFolder, { recursive: true, force: true });
}
