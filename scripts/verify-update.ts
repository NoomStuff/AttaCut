import { requireDisposableDesktop } from "./test-isolation";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { _electron as electron } from "@playwright/test";
import manifest from "../package.json";
import { asarVersion, setAsarVersion } from "./asar-version";

interface Sample {
   t: number;
   windows: { hwnd: number; pid: number; path: string; class: string; title: string }[];
   processes: { pid: number; path: string }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid: number) => {
   try {
      process.kill(pid, 0);
      return true;
   } catch {
      return false;
   }
};
// Runner temp folders use 8.3 names, while process images report whichever form launched them.
const canonical = (path: string) => {
   try {
      return realpathSync.native(path).toLowerCase();
   } catch {
      return resolve(path).toLowerCase();
   }
};
const same = (left: string, right: string) => canonical(left) === canonical(right);
const watchedFragments = ["installer.exe", "uninstall", "\\~nsu", "elevate.exe"];

/**
 * The in-app update path, end to end: install version N under a throwaway installer
 * identity, let that app find N+1 on a loopback feed and download it, press its own
 * "Restart to update" button, and require that no installer window appears, that N+1
 * relaunches by itself, and that user data survives. The old app runs the install, so this
 * checks the candidate's own updater against the candidate's own installer.
 */
export async function verifyUpdate(): Promise<void> {
   if (process.platform !== "win32") return;
   requireDisposableDesktop();
   const unpacked = resolve("release/win-unpacked");
   if (!existsSync(join(unpacked, "AttaCut-app.exe"))) throw new Error("The update test needs the packaged Windows app.");
   const [major, minor, patch] = manifest.version.split(/[.-]/).map(Number) as [number, number, number];
   const oldVersion = manifest.version;
   const newVersion = `${major}.${minor}.${patch + 1}`;
   const results = resolve("test-results/update-e2e");
   await mkdir(results, { recursive: true });
   await mkdir("work", { recursive: true });
   const root = await mkdtemp(resolve("work/update-test-"));
   const guid = randomUUID();
   const identity = `dev.attacut.updatetest.${guid}`;
   const packageName = `attacut-updatetest-${guid}`;
   const cacheName = `${packageName}-updater`;
   const localAppData = process.env["LOCALAPPDATA"];
   if (!localAppData) throw new Error("Windows test requires LOCALAPPDATA.");
   const updaterCache = join(localAppData, cacheName);
   const temporary = realpathSync.native(tmpdir());
   const installRoot = realpathSync.native(await mkdtemp(join(temporary, "attacut-update-install-")));
   if (dirname(installRoot) !== temporary) throw new Error("Update test escaped the temporary directory.");

   // Two copies of the exact candidate payload that differ only in their version.
   const installers: Record<string, string> = {};
   let feed = "";
   for (const version of [oldVersion, newVersion]) {
      const payload = join(root, `payload-${version}`);
      await cp(unpacked, payload, { recursive: true });
      await setAsarVersion(join(payload, "resources/app.asar"), version);
      await writeFile(join(payload, "resources/app-update.yml"), `provider: generic\nurl: http://127.0.0.1/feed/\nupdaterCacheDirName: ${cacheName}\n`);
      const output = join(root, `installer-${version}`);
      const config = join(root, `${version}.json`);
      await writeFile(
         config,
         JSON.stringify({
            ...manifest.build,
            appId: identity,
            compression: "store",
            extraMetadata: { version, name: packageName },
            fileAssociations: [],
            directories: { output },
            publish: [{ provider: "generic", url: "http://127.0.0.1/feed/" }],
            nsis: { ...manifest.build.nsis, guid, differentialPackage: false, shortcutName: `AttaCut Update Test ${guid}` },
         })
      );
      execFileSync(
         process.execPath,
         ["x", "--no-install", "electron-builder", "--win", "nsis", "--x64", "--prepackaged", payload, "--config", config, "--publish=never"],
         { stdio: "inherit", windowsHide: true }
      );
      installers[version] = join(output, `AttaCut-${version}-win-x64-Installer.exe`);
      if (version === newVersion) feed = await readFile(join(output, "latest.yml"), "utf8");
   }
   const packageFile = /^\s*-\s*url:\s*(\S+)\s*$/m.exec(feed)?.[1];
   if (!packageFile || !existsSync(join(dirname(installers[newVersion]!), packageFile))) throw new Error("The test feed does not describe the new installer.");

   const requests: string[] = [];
   const server = createServer((request, response) => {
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      requests.push(path);
      if (path === "/releases/latest") {
         response.setHeader("content-type", "application/json");
         response.end(
            JSON.stringify({
               tag_name: `v${newVersion}`,
               name: `AttaCut ${newVersion}`,
               html_url: `${updateServer}releases/tag/v${newVersion}`,
               draft: false,
               prerelease: false,
            })
         );
      } else if (path === "/feed/latest.yml") response.end(feed);
      else if (path === `/feed/${packageFile}`) createReadStream(join(dirname(installers[newVersion]!), packageFile)).pipe(response);
      else {
         response.statusCode = 404;
         response.end();
      }
   });
   await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
   const updateServer = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

   const recorderExe = join(root, "window-recorder.exe");
   const csc = ["C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe", "C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe"].find(existsSync);
   if (!csc) throw new Error("The update test requires the .NET Framework compiler.");
   execFileSync(
      csc,
      ["/nologo", "/target:exe", `/out:${recorderExe}`, "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", resolve("scripts/splash/window-recorder.cs")],
      {
         stdio: "inherit",
         windowsHide: true,
      }
   );
   const reports: Record<string, unknown>[] = [];
   const failures: string[] = [];
   try {
      for (const scope of ["currentuser", "allusers"] as const) {
         const install = join(installRoot, scope);
         const shots = join(results, scope);
         await mkdir(shots, { recursive: true });
         execFileSync(installers[oldVersion]!, ["/S", `/${scope}`, `/D=${install}`], { stdio: "pipe", windowsHide: true, timeout: 180_000 });
         const appExe = join(install, "AttaCut-app.exe");
         if (!existsSync(appExe) || (await asarVersion(join(install, "resources/app.asar"))) !== oldVersion)
            throw new Error(`${scope}: version ${oldVersion} did not install.`);
         const environment: Record<string, string> = {
            ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
            ATTACUT_TESTING: "1",
            ATTACUT_TEST_UPDATE_SERVER: updateServer,
            ATTACUT_OPEN_FILE: "",
         };
         delete environment["ELECTRON_RUN_AS_NODE"];
         delete environment["ATTACUT_HIDDEN"];
         delete environment["ATTACUT_USER_DATA"];

         // The relaunched app starts from the installer's shortcut without this process's
         // environment, so both runs use the test identity's default profile on this runner.
         let profile = "";
         let logs = "";
         {
            // A closed loopback port: this launch only discovers the profile and checks nothing.
            const first = await electron.launch({ executablePath: appExe, env: { ...environment, ATTACUT_TEST_UPDATE_SERVER: "http://127.0.0.1:9/" } });
            try {
               await (await first.firstWindow()).locator(".app-shell").waitFor({ state: "attached" });
               [profile, logs] = await first.evaluate(({ app }) => [app.getPath("userData"), app.getPath("logs")]);
            } finally {
               await first.close();
            }
         }
         const settingsPath = join(profile, "settings.json");
         const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { preferences: Record<string, unknown> };
         settings.preferences["clipNamePattern"] = `update-e2e ${guid} {n}`;
         await writeFile(settingsPath, JSON.stringify(settings));
         await writeFile(join(profile, "update-preserve.txt"), guid);
         await rm(join(logs, "updater.log"), { force: true });

         const samplesPath = join(root, `windows-${scope}.jsonl`);
         const stop = join(root, `stop-${scope}`);
         const recorder = spawn(recorderExe, [samplesPath, stop, shots, [install, updaterCache, ...watchedFragments].join(";")], {
            stdio: "ignore",
            windowsHide: true,
         });
         // A loaded video gives the restart real work to tear down: previews, waveform and probes.
         const video = resolve("work/fixture.mp4");
         const application = await electron.launch({ executablePath: appExe, env: { ...environment, ATTACUT_OPEN_FILE: existsSync(video) ? video : "" } });
         const oldPid = application.process().pid!;
         const report: Record<string, unknown> = { scope, oldVersion, newVersion };
         try {
            const page = await application.firstWindow();
            const restart = page.getByRole("button", { name: "Restart to update", exact: true });
            await restart.waitFor({ state: "visible", timeout: 180_000 });
            const clicked = Date.now();
            report["clicked"] = clicked;
            await restart.click();
            let exited = 0;
            const exitDeadline = Date.now() + 120_000;
            while (!exited && Date.now() < exitDeadline) {
               if (!alive(oldPid)) exited = Date.now();
               else await sleep(50);
            }
            report["clickToExitMs"] = exited ? exited - clicked : null;
            if (!exited) failures.push(`${scope}: the app was still running 120s after Restart to update.`);
            // The relaunch is the new runtime from the install folder with a visible window.
            let relaunched = 0;
            const relaunchDeadline = Date.now() + 240_000;
            while (!relaunched && Date.now() < relaunchDeadline) {
               await sleep(250);
               const samples = existsSync(samplesPath)
                  ? (await readFile(samplesPath, "utf8"))
                       .split("\n")
                       .filter(Boolean)
                       .map((line) => JSON.parse(line) as Sample)
                  : [];
               const found = samples.find(
                  (sample) => sample.t > clicked && sample.windows.some((window) => window.pid !== oldPid && same(window.path, appExe) && window.title)
               );
               if (found) relaunched = found.t;
            }
            report["clickToRelaunchMs"] = relaunched ? relaunched - clicked : null;
            if (!relaunched) failures.push(`${scope}: ${newVersion} did not relaunch within 240s.`);
            await sleep(3000);
         } finally {
            await writeFile(stop, "");
            await new Promise((resolveExit) => recorder.once("exit", resolveExit));
            await application.close().catch(() => undefined);
         }
         const samples = (await readFile(samplesPath, "utf8"))
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Sample);
         const clicked = report["clicked"] as number;
         const after = samples.filter((sample) => sample.t >= clicked);
         const windowGone = after.find((sample) => !sample.windows.some((window) => window.pid === oldPid));
         report["clickToWindowGoneMs"] = windowGone ? windowGone.t - clicked : null;
         const installerSeen = after.filter((sample) => sample.processes.some((entry) => entry.path.toLowerCase().includes(updaterCache.toLowerCase())));
         report["installerStartMs"] = installerSeen[0] ? installerSeen[0].t - clicked : null;
         report["installerEndMs"] = installerSeen.length ? installerSeen[installerSeen.length - 1]!.t - clicked : null;
         const foreign = new Map<number, Sample["windows"][number]>();
         for (const sample of after)
            for (const window of sample.windows) {
               if (window.pid === oldPid || same(window.path, appExe) || same(window.path, join(install, "AttaCut.exe"))) continue;
               const path = canonical(window.path);
               const watched =
                  [install, updaterCache].some((folder) => path.startsWith(canonical(folder))) || watchedFragments.some((fragment) => path.includes(fragment));
               if (watched || window.class === "#32770") foreign.set(window.hwnd, window);
            }
         report["installerWindows"] = [...foreign.values()];
         if (foreign.size) failures.push(`${scope}: ${foreign.size} installer window(s) appeared: ${JSON.stringify([...foreign.values()])}`);
         const installedVersion = await asarVersion(join(install, "resources/app.asar"));
         report["installedVersion"] = installedVersion;
         if (installedVersion !== newVersion) failures.push(`${scope}: installed version is ${installedVersion}, expected ${newVersion}.`);
         const preserved = JSON.parse(await readFile(settingsPath, "utf8")) as { preferences: Record<string, unknown> };
         if (preserved.preferences["clipNamePattern"] !== `update-e2e ${guid} {n}`) failures.push(`${scope}: the update changed saved preferences.`);
         if ((await readFile(join(profile, "update-preserve.txt"), "utf8")) !== guid) failures.push(`${scope}: the update changed a user file.`);
         // The relaunched app consumes the install record at startup.
         if (existsSync(join(profile, "update-install.json"))) failures.push(`${scope}: the relaunched app did not consume its install record.`);
         report["requests"] = [...new Set(requests)];
         if (existsSync(join(logs, "updater.log"))) {
            const log = await readFile(join(logs, "updater.log"), "utf8");
            await writeFile(join(results, `updater-${scope}.log`), log);
            // Which of electron-updater's install paths ran: direct spawn, elevate.exe, or the interactive fallback.
            report["installPath"] = log.split("\n").filter((line) => /Executing:|Cannot run installer|isAdminRightsRequired|Install:/.test(line));
         } else failures.push(`${scope}: the updater wrote no log.`);
         await cp(samplesPath, join(results, `windows-${scope}.jsonl`));
         reports.push(report);
         console.log(`Update ${scope}: ${JSON.stringify(report)}`);
         // Stop the relaunched app and leave nothing from this scope behind.
         execFileSync(
            "powershell",
            [
               "-NoProfile",
               "-Command",
               `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${install.replaceAll("'", "''")}', 'CurrentCultureIgnoreCase') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
            ],
            { stdio: "inherit", windowsHide: true }
         );
         await sleep(1000);
         const uninstaller = join(install, "Uninstall AttaCut.exe");
         if (existsSync(uninstaller)) execFileSync(uninstaller, ["/S", `/${scope}`, `_?=${install}`], { stdio: "pipe", windowsHide: true, timeout: 180_000 });
      }
   } finally {
      server.closeAllConnections();
      server.close();
      await writeFile(join(results, "report.json"), JSON.stringify({ reports, failures }, null, 2));
      // Whatever a failed run left behind: installer, uninstaller or app processes.
      execFileSync(
         "powershell",
         [
            "-NoProfile",
            "-Command",
            `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath.StartsWith('${installRoot.replaceAll("'", "''")}', 'CurrentCultureIgnoreCase') -or $_.ExecutablePath.StartsWith('${updaterCache.replaceAll("'", "''")}', 'CurrentCultureIgnoreCase')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
         ],
         { stdio: "inherit", windowsHide: true }
      );
      for (const scope of ["currentuser", "allusers"]) {
         const uninstaller = join(installRoot, scope, "Uninstall AttaCut.exe");
         if (existsSync(uninstaller)) {
            try {
               execFileSync(uninstaller, ["/S", `/${scope}`, `_?=${join(installRoot, scope)}`], { stdio: "pipe", windowsHide: true, timeout: 180_000 });
            } catch {
               // Best effort on a disposable runner.
            }
         }
      }
      await rm(installRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
      await rm(updaterCache, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
   }
   if (failures.length) throw new Error(`In-app update failed:\n${failures.join("\n")}`);
}

if (import.meta.main) await verifyUpdate();
