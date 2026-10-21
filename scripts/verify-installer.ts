import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import manifest from "../package.json";
import { _electron as electron } from "@playwright/test";

// A separate NSIS identity, shortcut name, shell verb and installation folder
// prevent tests from discovering or modifying the user's real installation.
export async function verifyInstaller(): Promise<void> {
   if (process.platform !== "win32") return;
   await mkdir("work", { recursive: true });
   const root = await mkdtemp(resolve("work/installer-test-"));
   const guid = randomUUID();
   const identity = `dev.attacut.installtest.${guid}`;
   const packageName = `attacut-installtest-${guid}`;
   const localAppData = process.env["LOCALAPPDATA"];
   if (!localAppData) throw new Error("Windows test requires LOCALAPPDATA.");
   const updaterCache = join(localAppData, `${packageName}-updater`);
   const installRoot = await mkdtemp(join(tmpdir(), "trim-install-"));
   if (dirname(installRoot) !== resolve(tmpdir())) throw new Error("Installer test escaped the temporary directory.");
   const install = join(installRoot, "video");
   const profile = join(root, "profile");
   const testOutput = join(root, "ui-results");
   const include = join(root, "installer.nsh");
   // Omit only the final completion page so an interactive upgrade must pass
   // every preceding page without input and exit. A repeated setup choice
   // instead waits for input and fails the process timeout.
   await writeFile(include, `!include "${resolve("build/installer.nsh")}"\nAutoCloseWindow true\n!macro customFinishPage\n!macroend\n`);
   await mkdir(profile);
   await writeFile(join(profile, "installer-preserve.txt"), "preserve user file");
   const command = (file: string, args: string[]) => execFileSync(file, args, { stdio: "pipe", windowsHide: true, timeout: 180_000 });
   try {
      for (const [stage, version] of [
         ["baseline", "0.0.1"],
         ["upgrade", manifest.version],
      ] as const) {
         const settings = join(profile, "settings.json");
         const previousSettings = existsSync(settings) ? await readFile(settings, "utf8") : null;
         const config = join(root, `${stage}.json`);
         await writeFile(
            config,
            JSON.stringify({
               ...manifest.build,
               appId: identity,
               compression: "store",
               extraMetadata: { version, name: packageName },
               fileAssociations: [],
               directories: { output: join(root, stage) },
               nsis: { ...manifest.build.nsis, include, guid, differentialPackage: false, shortcutName: `AttaCut Test ${guid}`, runAfterFinish: false },
            })
         );
         execFileSync(
            process.execPath,
            [
               "x",
               "--no-install",
               "electron-builder",
               "--win",
               "nsis",
               "--x64",
               "--prepackaged",
               resolve("release/win-unpacked"),
               "--config",
               config,
               "--publish=never",
            ],
            { stdio: "inherit", windowsHide: true }
         );
         const installer = join(root, stage, `AttaCut-${version}-win-x64-Installer.exe`);
         command(installer, stage === "baseline" ? ["/S", "/currentuser", `/D=${install}`] : []);
         if (previousSettings !== null && (await readFile(settings, "utf8")) !== previousSettings) throw new Error("Installer changed profile settings.");
         const location = command("reg", ["query", `HKCU\\Software\\${guid}`, "/v", "InstallLocation"]).toString();
         if (!location.includes(install) || !existsSync(join(install, "AttaCut.exe"))) throw new Error(`${stage} did not preserve its installation location.`);
         const environment: Record<string, string> = {
            ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
            ATTACUT_TESTING: "1",
            ATTACUT_HIDDEN: "1",
            ATTACUT_USER_DATA: profile,
            ATTACUT_OPEN_FILE: "",
         };
         delete environment["ELECTRON_RUN_AS_NODE"];
         const app = await electron.launch({ executablePath: join(install, "AttaCut-app.exe"), env: environment });
         try {
            const page = await app.firstWindow();
            await page.locator(".app-shell").waitFor({ state: "attached" });
            if ((await app.evaluate(({ app }) => app.getPath("userData"))) !== profile) throw new Error("Installed test app did not use its isolated profile.");
         } finally {
            await app.close();
         }
         if ((await readFile(join(profile, "installer-preserve.txt"), "utf8")) !== "preserve user file") throw new Error("Installer changed a user file.");
         console.log(`Isolated per-user ${stage} passed at ${install}`);
      }
      const installedEnvironment = {
         ...process.env,
         ATTACUT_TEST_OUTPUT: testOutput,
         ATTACUT_EXECUTABLE: join(install, "AttaCut-app.exe"),
         FFMPEG_PATH: join(install, "resources/media/ffmpeg.exe"),
         FFPROBE_PATH: join(install, "resources/media/ffprobe.exe"),
      };
      // A fresh package job has not run the full media suite yet. Build the
      // editor fixtures with the installed binaries before its playback tests.
      execFileSync(process.execPath, ["tests/create-fixtures.ts"], { stdio: "inherit", windowsHide: true, env: installedEnvironment });
      execFileSync(
         process.execPath,
         ["x", "--no-install", "playwright", "test", "--project=ui", "tests/ui/editor-session.spec.mjs", "tests/ui/export-workflow.spec.mjs"],
         {
            stdio: "inherit",
            windowsHide: true,
            env: installedEnvironment,
         }
      );
   } catch (error) {
      if (existsSync(testOutput)) {
         const diagnostics = resolve("test-results", `installer-${guid}`);
         await mkdir(diagnostics, { recursive: true });
         await cp(testOutput, diagnostics, { recursive: true });
      }
      throw error;
   } finally {
      const uninstaller = join(install, "Uninstall AttaCut.exe");
      if (existsSync(uninstaller)) command(uninstaller, ["/S", "/currentuser", `_?=${install}`]);
      await rm(installRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      await rm(updaterCache, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
   }
}

if (import.meta.main) await verifyInstaller();
