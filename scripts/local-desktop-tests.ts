import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { runOnPrivateDesktop } from "./private-desktop";
import { localMediaEnv } from "./provision-media";

const projects = ["ui", "playback", "native"] as const;
type Project = (typeof projects)[number];
const isProject = (value: string | undefined): value is Project => projects.some((project) => project === value);

const usage = `Usage: bun run test:local [ui|playback|native] [--no-build] [playwright args...]

Runs Playwright app tests on the working tree, on a private Xvfb display with its own
audio server and D-Bus session. Your desktop, speakers and keyboard focus are untouched.

  bun run test:local                         every ui spec
  bun run test:local timeline                specs whose file name matches "timeline"
  bun run test:local -g "splits a clip"      tests whose title matches
  bun run test:local playback                format playback matrix
  bun run test:local --no-build export-dialog  reuse the last build in out/

Results, traces and failure screenshots land in test-results/.`;

const run = (args: string[], env: NodeJS.ProcessEnv = process.env): void => {
   execFileSync(process.execPath, args, { stdio: "inherit", env });
};

const fixtures = ["work/fixture.mp4", "work/fixture.mkv", "work/fixture-hevc.mp4", "work/named-audio.mp4"];
function fixturesAreCurrent(): boolean {
   const source = statSync("tests/create-fixtures.ts").mtimeMs;
   return fixtures.every((path) => existsSync(path) && statSync(path).mtimeMs >= source);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
   console.log(usage);
   process.exit(0);
}
const skipBuild = args.includes("--no-build");
const playwrightArgs = args.filter((arg) => arg !== "--no-build");
const first = playwrightArgs[0];
const project: Project = isProject(first) ? first : "ui";
if (isProject(first)) playwrightArgs.shift();
// Match the hosted runner's single retry. Playwright then reports a pass on retry as flaky instead of failed.
if (!playwrightArgs.some((arg) => arg.startsWith("--retries"))) playwrightArgs.push("--retries=1");

Object.assign(process.env, await localMediaEnv());
if (!fixturesAreCurrent()) run(["tests/create-fixtures.ts"]);
if (skipBuild && !existsSync("out/main/index.js")) throw new Error("--no-build needs an earlier build in out/. Drop the flag once.");
if (!skipBuild) {
   // Typechecking is left to bun run verify, so a UI iteration only pays for the bundle.
   run(["run", "build:icons"]);
   run(["x", "--no-install", "electron-vite", "build"]);
}

const nativeEnv: NodeJS.ProcessEnv = project === "native" ? { ATTACUT_NATIVE_SMOKE: "1", ATTACUT_TEST_SCREEN_CAPTURE: "1" } : {};
const status = runOnPrivateDesktop([process.execPath, "x", "--no-install", "playwright", "test", `--project=${project}`, ...playwrightArgs], {
   // The private display is disposable, so exercise real visible windows like the hosted runner.
   ATTACUT_TEST_VISIBLE: "1",
   ...nativeEnv,
});
process.exit(status);
