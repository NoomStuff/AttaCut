import { execFileSync } from "node:child_process";
import { provisionMedia } from "./provision-media.ts";

const run = (args: string[], env: NodeJS.ProcessEnv) => execFileSync(process.execPath, args, { stdio: "inherit", env });

run(["install", "--frozen-lockfile"], process.env);
const env = { ...process.env, ...(await provisionMedia()), CI: "true" };
run(["run", "verify"], env);
run(["run", "test:media"], env);
run(["x", "--no-install", "playwright", "test"], env);
run(["run", "dist"], { ...env, CSC_IDENTITY_AUTO_DISCOVERY: "false" });
run(["run", "verify:package"], env);
