import { z } from "zod";
import type { AvailableUpdate } from "../shared/types.ts";
import { app, net, type BrowserWindow } from "electron";
import { isPackagedApp } from "./identity.ts";
import { createHash } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import type { UpdateStatus } from "../shared/types.ts";
import { IpcEvents } from "../shared/ipc.ts";
import type { AppUpdater } from "electron-updater";

const updateFeedUrl = "https://raw.githubusercontent.com/NoomStuff/AttaCut/updates/";

const releaseSchema = z.object({
   tag_name: z.string(),
   name: z.string().nullable(),
   html_url: z.string().url(),
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

export async function fetchAvailableUpdate(
   currentVersion: string,
   request: (url: string, init: RequestInit) => Promise<Response>
): Promise<AvailableUpdate | null> {
   const response = await request("https://api.github.com/repos/NoomStuff/AttaCut/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": `AttaCut/${currentVersion}` },
      signal: AbortSignal.timeout(30_000),
   });
   if (!response.ok) throw new Error(`Update check failed with ${response.status}.`);
   const release = releaseSchema.parse(await response.json());
   const version = release.tag_name.replace(/^v/, "");
   if (release.draft || release.prerelease || !isNewerVersion(version, currentVersion)) return null;
   return { version, name: release.name?.trim() || `AttaCut ${version}`, url: release.html_url, mode: "releases" };
}

function updateMode(): AvailableUpdate["mode"] {
   if (!isPackagedApp()) return "releases";
   if (process.platform === "win32")
      return process.env["PORTABLE_EXECUTABLE_FILE"] ? "download" : existsSync(join(process.resourcesPath, "app-update.yml")) ? "automatic" : "releases";
   if (process.platform === "linux") return process.env["APPIMAGE"] && existsSync(join(process.resourcesPath, "app-update.yml")) ? "automatic" : "releases";
   // CI builds unsigned DMGs. Squirrel.Mac needs a signed build and ZIP update feed.
   return "releases";
}

export class UpdateManager {
   private readonly window: BrowserWindow;
   private updater: AppUpdater | null = null;
   private current: AvailableUpdate | null = null;
   private busy = false;
   private readyVersion: string | null = null;
   private automaticVersion: string | null = null;
   private automaticRunning = false;
   private automaticWired = false;
   downloadedPath: string | null = null;
   constructor(window: BrowserWindow) {
      this.window = window;
   }

   private emit(status: UpdateStatus): void {
      if (!this.window.isDestroyed()) this.window.webContents.send(IpcEvents.updateStatus, status);
   }

   async offer(update: AvailableUpdate): Promise<AvailableUpdate> {
      const mode = updateMode();
      this.current = { ...update, mode };
      if (mode === "automatic" && !this.automaticRunning && !this.isReady) void this.prepareAutomatic(this.current);
      return this.current;
   }

   private async prepareAutomatic(update: AvailableUpdate): Promise<void> {
      this.automaticRunning = true;
      this.automaticVersion = update.version;
      try {
         const module = await import("electron-updater");
         const updater = module.autoUpdater ?? module.default.autoUpdater;
         this.updater = updater;
         updater.setFeedURL({ provider: "generic", url: updateFeedUrl });
         updater.autoDownload = true;
         updater.autoInstallOnAppQuit = false;
         // Only app packages appear on GitHub Releases; NSIS must download the
         // full installer because its separate blockmap is not published.
         if (process.platform === "win32") updater.disableDifferentialDownload = true;
         // electron-updater exposes a module singleton: wiring the listeners once keeps
         // repeated update offers from stacking duplicate progress and error handlers.
         if (!this.automaticWired) {
            this.automaticWired = true;
            updater.on("update-available", (info) => {
               this.automaticVersion = info.version;
            });
            updater.on("download-progress", (progress) =>
               this.emit({ phase: "downloading", version: this.automaticVersion!, percent: Math.round(progress.percent) })
            );
            updater.on("update-downloaded", (info) => {
               this.readyVersion = info.version;
               this.emit({ phase: "ready", version: info.version, percent: 100 });
            });
            updater.on("error", () =>
               this.emit({
                  phase: "error",
                  version: this.automaticVersion!,
                  percent: null,
                  message: "Could not download the update. Open the release to update manually.",
               })
            );
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
      } catch {
         this.emit({ phase: "error", version: update.version, percent: null, message: "Could not download the update. Open the release to update manually." });
      } finally {
         this.automaticRunning = false;
         // A newer release can be offered while the previous package is downloading.
         if (this.current?.mode === "automatic" && this.current.version !== update.version && !this.isReady) void this.prepareAutomatic(this.current);
      }
   }

   install(): void {
      if (!this.isReady) throw new Error("The update is not ready yet.");
      this.updater!.quitAndInstall(false, true);
   }
   get isReady(): boolean {
      return this.readyVersion !== null && this.readyVersion === this.current?.version && this.updater !== null;
   }

   async downloadPortable(version: string): Promise<void> {
      if (this.busy || this.current?.mode !== "download" || this.current.version !== version || !/^\d+\.\d+\.\d+$/.test(version))
         throw new Error("This download is not available.");
      this.busy = true;
      let temporary: string | null = null;
      // A stalled connection must not pin the download slot forever: the watchdog aborts
      // after 30 seconds without progress, mirroring the media runner's idle policy.
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
                  reject(error);
               }
            );
         });
      try {
         const name = `AttaCut-${version}-win-${process.arch}.exe`;
         const releaseResponse = await guarded(
            net.fetch(`https://api.github.com/repos/NoomStuff/AttaCut/releases/tags/v${version}`, {
               headers: { Accept: "application/vnd.github+json", "User-Agent": `AttaCut/${app.getVersion()}` },
               signal: abort.signal,
            })
         );
         if (!releaseResponse.ok) throw new Error("Could not find that release.");
         const release = z
            .object({ assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url(), digest: z.string().nullable().optional() })) })
            .parse(await guarded(releaseResponse.json()));
         const asset = release.assets.find((entry) => entry.name === name);
         if (!asset) throw new Error("The matching download is missing from this release.");
         const expectedHash = asset.digest?.startsWith("sha256:") ? asset.digest.slice(7) : null;
         if (!expectedHash || !/^[0-9a-f]{64}$/i.test(expectedHash)) throw new Error("The download could not be verified.");
         const directory = app.getPath("downloads");
         const stem = name.slice(0, -4);
         let destination = join(directory, name);
         for (let index = 2; existsSync(destination) || existsSync(`${destination}.part`); index++) destination = join(directory, `${stem} (${index}).exe`);
         temporary = `${destination}.part`;
         const response = await guarded(net.fetch(asset.browser_download_url, { signal: abort.signal }));
         if (!response.ok || !response.body) throw new Error("The download failed.");
         const file = await open(temporary, "wx");
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
         await rename(temporary, destination);
         temporary = null;
         this.downloadedPath = destination;
         this.emit({ phase: "downloaded", version, percent: 100, message: `Saved ${basename(destination)} to Downloads.`, path: destination });
      } catch (error) {
         this.emit({ phase: "error", version, percent: null, message: error instanceof Error ? error.message : "The download failed." });
         throw error;
      } finally {
         abort.abort();
         if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
         this.busy = false;
      }
   }
}
