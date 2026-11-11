// Shared updater core. AcroClip, AttaCut and Deduup carry this file line for line, apart
// from the imports and the app block below. Copy every change to all three apps.
import { app, net } from "electron";
import { createHash } from "node:crypto";
import { constants, existsSync } from "node:fs";
import { copyFile, link, open, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import type { AppUpdater } from "electron-updater";
import type { AvailableUpdate, UpdateStatus } from "../shared/types.ts";
import { isPackagedApp } from "./identity.ts";

// App block: the only lines that differ between the apps.
const product = "AttaCut";
const repository = "NoomStuff/AttaCut";
const testFlag = "ATTACUT_TESTING";
const testServerVariable = "ATTACUT_TEST_UPDATE_SERVER";
// End of the app block.

const releaseSchema = z.object({
   tag_name: z.string(),
   name: z.string().nullable(),
   html_url: z.url(),
   draft: z.boolean(),
   prerelease: z.boolean(),
});

export function isNewerVersion(candidate: string, current: string): boolean {
   const parse = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
   const next = parse(candidate);
   const installed = parse(current);
   if (!next || !installed) return false;
   for (let index = 1; index <= 3; index++) {
      if (Number(next[index]) !== Number(installed[index])) return Number(next[index]) > Number(installed[index]);
   }
   if (!next[4] || !installed[4]) return !next[4] && !!installed[4];
   const a = next[4].split(".");
   const b = installed[4].split(".");
   for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const left = a[index];
      const right = b[index];
      if (left === right) continue;
      if (left === undefined || right === undefined) return right === undefined;
      const leftNumeric = /^\d+$/.test(left);
      const rightNumeric = /^\d+$/.test(right);
      if (leftNumeric && rightNumeric) return Number(left) > Number(right);
      if (leftNumeric !== rightNumeric) return !leftNumeric;
      return left > right;
   }
   return false;
}

/** Isolated update tests serve releases and the feed locally. Only test launches may redirect them, and only to loopback. */
export function testUpdateServer(environment: NodeJS.ProcessEnv = process.env): string | null {
   const server = environment[testServerVariable];
   if (environment[testFlag] !== "1" || !server) return null;
   try {
      const url = new URL(server);
      return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) ? url.href.replace(/\/$/, "") : null;
   } catch {
      return null;
   }
}

export function updateEndpoints(environment: NodeJS.ProcessEnv = process.env): { releases: string; feed: string } {
   const server = testUpdateServer(environment);
   if (server) return { releases: `${server}/releases/latest`, feed: `${server}/feed/` };
   // The feed is the newest release's latest.yml, through GitHub's latest-release redirect.
   return { releases: `https://api.github.com/repos/${repository}/releases/latest`, feed: `https://github.com/${repository}/releases/latest/download/` };
}

export async function fetchAvailableUpdate(
   currentVersion: string,
   request: (url: string, init: RequestInit) => Promise<Response>,
   url = updateEndpoints().releases
): Promise<AvailableUpdate | null> {
   const response = await request(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `${product}/${currentVersion}` },
      signal: AbortSignal.timeout(30_000),
   });
   if (!response.ok) throw new Error(`Update check failed with ${response.status}.`);
   const release = releaseSchema.parse(await response.json());
   // The release page opens in the browser, so it must be one of this project's releases.
   if (!testUpdateServer() && !release.html_url.startsWith(`https://github.com/${repository}/releases/`))
      throw new Error("The update check returned an unexpected release URL.");
   const version = release.tag_name.replace(/^v/, "");
   if (release.draft || release.prerelease || !isNewerVersion(version, currentVersion)) return null;
   const name = release.name?.trim() ?? "";
   return { version, name: name.length > 0 ? name : `${product} ${version}`, url: release.html_url, mode: "releases" };
}

export function updateMode(): AvailableUpdate["mode"] {
   if (!isPackagedApp()) return "releases";
   if (process.platform === "win32")
      return process.env["PORTABLE_EXECUTABLE_FILE"] ? "download" : existsSync(join(process.resourcesPath, "app-update.yml")) ? "automatic" : "releases";
   if (process.platform === "linux") return process.env["APPIMAGE"] && existsSync(join(process.resourcesPath, "app-update.yml")) ? "automatic" : "releases";
   // Mac builds are unsigned, and Squirrel.Mac only updates signed apps. Mac users get the release page.
   return "releases";
}

interface Spawner {
   spawnLog?: (command: string, args?: string[], ...rest: unknown[]) => Promise<boolean>;
}

/**
 * NSIS checks its own CRC before running, and for an installer this size it shows a
 * "verifying installer" window even under /S. electron-updater has already verified the
 * installer's SHA-512 after downloading it, so the update run skips that second check.
 * Installers started by hand keep it. Applies to the direct and elevate.exe launches alike.
 */
export function skipInstallerCrc(updater: unknown): void {
   const target = updater as Spawner;
   const spawn = target.spawnLog;
   if (typeof spawn !== "function") return;
   target.spawnLog = (command, args = [], ...rest) =>
      spawn.call(
         updater,
         command,
         args.flatMap((arg) => (arg === "--updated" ? [arg, "/NCRC"] : [arg])),
         ...rest
      );
}

export class UpdateManager {
   private readonly changed: (status: UpdateStatus) => void;
   private readonly log: (message: string) => void;
   private installFailed: ((message: string) => void) | null = null;
   private updater: AppUpdater | null = null;
   private current: AvailableUpdate | null = null;
   private busy = false;
   private readyVersion: string | null = null;
   private automaticVersion: string | null = null;
   private automaticRunning = false;
   private automaticWired = false;
   downloadedPath: string | null = null;
   constructor(changed: (status: UpdateStatus) => void, log: (message: string) => void = () => undefined) {
      this.changed = changed;
      this.log = log;
   }

   /** Sends a status to the app. Apps also report their own install phases through it. */
   emit(status: UpdateStatus): void {
      this.changed(status);
   }

   /** The version an explicit restart would install. */
   get readyUpdate(): AvailableUpdate | null {
      return this.isReady ? this.current : null;
   }

   get isReady(): boolean {
      return this.readyVersion !== null && this.readyVersion === this.current?.version && this.updater !== null;
   }

   offer(update: AvailableUpdate): AvailableUpdate {
      const mode = updateMode();
      this.current = { ...update, mode };
      if (mode === "automatic" && !this.automaticRunning && !this.isReady) void this.prepareAutomatic(this.current);
      return this.current;
   }

   private async prepareAutomatic(update: AvailableUpdate): Promise<void> {
      this.automaticRunning = true;
      this.automaticVersion = update.version;
      try {
         // The CommonJS module arrives under default in some loaders.
         const module = (await import("electron-updater")) as { autoUpdater?: AppUpdater; default?: { autoUpdater?: AppUpdater } };
         const updater = module.autoUpdater ?? module.default?.autoUpdater;
         if (updater === undefined) throw new Error("electron-updater is unavailable.");
         this.updater = updater;
         // GitHub's download host does not answer multi-range requests, so a differential
         // download fetches its changed blocks one range at a time.
         updater.setFeedURL({ provider: "generic", url: updateEndpoints().feed, useMultipleRangeRequest: false });
         // Install failures are otherwise invisible: electron-updater falls back to
         // elevation or an interactive installer without telling the app why.
         updater.logger = {
            info: (message?: unknown) => this.log(`updater: ${String(message)}`),
            warn: (message?: unknown) => this.log(`updater warning: ${String(message)}`),
            error: (message?: unknown) => this.log(`updater error: ${String(message)}`),
         };
         updater.autoDownload = true;
         updater.autoInstallOnAppQuit = false;
         // electron-updater exposes a module singleton: wiring the listeners once keeps
         // repeated update offers from stacking duplicate progress and error handlers.
         if (!this.automaticWired) {
            this.automaticWired = true;
            if (process.platform === "win32") skipInstallerCrc(updater);
            updater.on("update-available", (info) => {
               this.automaticVersion = info.version;
            });
            updater.on("download-progress", (progress) =>
               this.emit({ phase: "downloading", version: this.automaticVersion ?? update.version, percent: Math.round(progress.percent) })
            );
            updater.on("update-downloaded", (info) => {
               this.readyVersion = info.version;
               this.emit({ phase: "ready", version: info.version, percent: 100 });
            });
            updater.on("error", (error: unknown) => {
               this.log(`updater error: ${error instanceof Error ? error.message : String(error)}`);
               const failed = this.installFailed;
               this.installFailed = null;
               if (failed) {
                  failed("Could not apply the update. Open the release to update manually.");
                  return;
               }
               this.emit({
                  phase: "error",
                  version: this.automaticVersion ?? update.version,
                  percent: null,
                  message: this.isReady
                     ? "Could not apply the update. Open the release to update manually."
                     : "Could not download the update. Open the release to update manually.",
               });
            });
         }
         this.emit({ phase: "downloading", version: update.version, percent: null });
         const result = await updater.checkForUpdates();
         if (result?.downloadPromise) await result.downloadPromise;
         if (this.readyVersion !== update.version)
            this.emit({
               phase: "error",
               version: update.version,
               percent: null,
               message: "The update package is not available yet. Open the release to update manually.",
            });
      } catch (error) {
         this.log(`updater error: ${error instanceof Error ? error.message : String(error)}`);
         this.emit({ phase: "error", version: update.version, percent: null, message: "Could not download the update. Open the release to update manually." });
      } finally {
         this.automaticRunning = false;
         // A newer release can be offered while the previous package is downloading.
         if (this.current?.mode === "automatic" && this.current.version !== update.version && !this.isReady) void this.prepareAutomatic(this.current);
      }
   }

   /**
    * Starts the silent installer and quits. Callers finish their own teardown first.
    * `failed` runs when the installer could not start.
    */
   install(failed: (message: string) => void = () => undefined): void {
      const updater = this.updater;
      const version = this.readyVersion;
      if (!this.isReady || updater === null || version === null) throw new Error("The update is not ready yet.");
      // A missing package makes electron-updater open the installer interactively
      // (its ENOENT fallback). Refuse instead, so the update never asks for clicks.
      const installer = (updater as unknown as { installerPath?: string | null }).installerPath;
      if (process.platform === "win32" && installer !== undefined && (!installer || !existsSync(installer))) {
         this.readyVersion = null;
         throw new Error("The downloaded update is missing. Check for updates to download it again.");
      }
      this.installFailed = failed;
      this.log(`updater: restarting from ${app.getVersion()} to install ${version}`);
      // Silent, then relaunch: the NSIS installer receives --updated /S --force-run.
      updater.quitAndInstall(true, true);
   }

   async downloadPortable(version: string): Promise<void> {
      if (this.busy || this.current?.mode !== "download" || this.current.version !== version || !/^\d+\.\d+\.\d+$/.test(version))
         throw new Error("This download is not available.");
      this.busy = true;
      let temporary: string | null = null;
      let temporaryOwned = false;
      // A stalled connection must not pin the download slot forever: the watchdog aborts
      // after 30 seconds without progress, so the user can retry.
      const abort = new AbortController();
      const guarded = <T>(work: Promise<T>): Promise<T> =>
         new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
               abort.abort();
               reject(new Error("The download stalled and was cancelled."));
            }, 30000);
            work.then(
               (value) => {
                  clearTimeout(timer);
                  resolve(value);
               },
               (error: unknown) => {
                  clearTimeout(timer);
                  reject(error instanceof Error ? error : new Error("The download failed."));
               }
            );
         });
      try {
         const name = `${product}-windows-${process.arch}-portable.exe`;
         const releaseResponse = await guarded(
            net.fetch(`https://api.github.com/repos/${repository}/releases/tags/v${version}`, {
               headers: { Accept: "application/vnd.github+json", "User-Agent": `${product}/${app.getVersion()}` },
               signal: abort.signal,
            })
         );
         if (!releaseResponse.ok) throw new Error("Could not find that release.");
         const release = z
            .object({ assets: z.array(z.object({ name: z.string(), browser_download_url: z.url(), digest: z.string().nullable().optional() })) })
            .parse(await guarded(releaseResponse.json()));
         const asset = release.assets.find((entry) => entry.name === name);
         if (!asset) throw new Error("The matching download is missing from this release.");
         const expectedHash = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
         if (!expectedHash || !/^[0-9a-f]{64}$/i.test(expectedHash)) throw new Error("The download could not be verified.");
         const directory = app.getPath("downloads");
         // The saved copy keeps the version, so several portable downloads stay apart.
         const stem = `${product}-${version}-windows-${process.arch}-portable`;
         let destination = join(directory, `${stem}.exe`);
         for (let index = 2; existsSync(destination) || existsSync(`${destination}.part`); index++) destination = join(directory, `${stem} (${index}).exe`);
         temporary = `${destination}.part`;
         const response = await guarded(net.fetch(asset.browser_download_url, { signal: abort.signal }));
         if (!response.ok || !response.body) throw new Error("The download failed.");
         const file = await open(temporary, "wx");
         temporaryOwned = true;
         const reader = response.body.getReader();
         const hash = createHash("sha256");
         const total = Number(response.headers.get("content-length")) || 0;
         let received = 0;
         let lastReported: number | null | undefined;
         try {
            for (;;) {
               const { done, value } = await guarded(reader.read());
               if (done) break;
               hash.update(value);
               await file.writeFile(value);
               received += value.length;
               const percent = total ? Math.min(99, Math.round((received / total) * 100)) : null;
               if (percent !== lastReported) {
                  lastReported = percent;
                  this.emit({ phase: "downloading", version, percent });
               }
            }
         } finally {
            await file.close();
         }
         if (hash.digest("hex").toLowerCase() !== expectedHash.toLowerCase()) throw new Error("The download did not pass verification.");
         // Publish without overwriting a file created while the download was in flight.
         // Downloads can live on a filesystem without hard links; both methods refuse an existing file.
         try {
            await link(temporary, destination);
         } catch (error) {
            if (!["ENOTSUP", "ENOSYS", "EPERM", "EXDEV", "EOPNOTSUPP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
            await copyFile(temporary, destination, constants.COPYFILE_EXCL);
         }
         await rm(temporary);
         temporaryOwned = false;
         temporary = null;
         this.downloadedPath = destination;
         this.emit({ phase: "downloaded", version, percent: 100, message: `Saved ${basename(destination)} to Downloads.`, path: destination });
      } catch (error) {
         this.emit({ phase: "error", version, percent: null, message: error instanceof Error ? error.message : "The download failed." });
         throw error;
      } finally {
         abort.abort();
         if (temporary && temporaryOwned) await rm(temporary, { force: true }).catch(() => undefined);
         this.busy = false;
      }
   }
}
