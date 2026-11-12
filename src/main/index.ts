import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { SourceSession } from "./source-session.ts";
import { SourceProbe } from "./source-probe";
import { pruneWaveforms } from "./media/waveform-cache";
import { ExportService } from "./exports.ts";
import { Storage } from "./storage.ts";
import { serveMedia, streamResponse } from "./media/serve.ts";
import { isProjectPath } from "../shared/project";
import { prunePreviews } from "./media/preview.ts";
import { IpcEvents } from "../shared/ipc.ts";
import { installMenu } from "./menu.ts";
import { RecentFiles } from "./recent.ts";
import { windowIcon, registerWindowsIdentity, isPackagedApp } from "./identity.ts";
import { fadeForExit, launcherPath, releaseSplash } from "./splash.ts";
import { registerIpc } from "./ipc.ts";
import { fileArgument } from "./launch-file";
import { IpcTestAdapter } from "./ipc-test-adapter";
import { UpdateManager } from "./update-manager.ts";
import { createUpdateLog } from "./update-log.ts";
import { clearInstallRecord, takeInstallOutcome, writeInstallRecord } from "./update-install-record.ts";
import type { AvailableUpdate } from "../shared/types";
import type { ExportJob } from "../shared/export";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
if (process.env["ATTACUT_USER_DATA"]) app.setPath("userData", process.env["ATTACUT_USER_DATA"]);
const ownsInstance = app.requestSingleInstanceLock();
const sourceProbe = new SourceProbe();
app.on("before-quit", () => sourceProbe.cancelPrefetch());
let appWindow: BrowserWindow | null = null;
let rendererReady = false;
let pendingFile = process.env["ATTACUT_OPEN_FILE"] ?? fileArgument(process.argv.slice(1));
const receiveFile = (path: string | null) => {
   if (appWindow && !appWindow.isDestroyed() && process.env["ATTACUT_HIDDEN"] !== "1") {
      if (appWindow.isMinimized()) appWindow.restore();
      appWindow.show();
      // Windows can deny foreground focus after the shell hands off a file.
      // Raise the existing window independently, before loading the new source.
      if (process.platform === "win32") appWindow.moveTop();
      appWindow.focus();
      appWindow.webContents.focus();
   }
   if (path && rendererReady && appWindow && !appWindow.isDestroyed()) appWindow.webContents.send(IpcEvents.openFile, path);
   else if (path) {
      pendingFile = path;
      if (!isProjectPath(path)) void sourceProbe.prefetch(path).catch(() => undefined);
   }
};
app.on("second-instance", (_event, args, workingDirectory) => receiveFile(fileArgument(args.slice(1), workingDirectory)));
app.on("open-file", (event, path) => {
   event.preventDefault();
   receiveFile(path);
});
app.setName("AttaCut");
if (process.platform === "linux") app.setDesktopName("attacut.desktop");
if (process.platform === "win32") app.setAppUserModelId("dev.attacut.app");
app.commandLine.appendSwitch("enable-blink-features", "AudioVideoTracks");
if (process.platform === "win32") {
   // Keep video in Chromium's compositor with the controls. Independent Windows
   // video overlays can retain stale geometry after fullscreen or occlusion changes.
   // These GPU driver workarounds leave hardware decoding and GPU rendering enabled.
   app.commandLine.appendSwitch("disable_direct_composition_video_overlays", "1");
   app.commandLine.appendSwitch("disable_direct_composition_sw_video_overlays", "1");
}
protocol.registerSchemesAsPrivileged([
   { scheme: "media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } },
   { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
async function start(): Promise<void> {
   // The read is small, but starting it here overlaps it with app and window init; IPC
   // handlers that answer from storage go live only after it resolves below.
   const storage = new Storage(app.getPath("userData"));
   const storageReady = storage.load();
   const recent = new RecentFiles(app.getPath("userData"));
   const recentReady = recent.load();
   // A launch argument is known before Electron initializes its window. Recovery
   // becomes known after storage loads. Neither probe waits for renderer startup.
   const prefetchStartup = () => {
      const path = pendingFile || (storage.preferences.resume ? storage.session?.path : null);
      if (path && !isProjectPath(path)) void sourceProbe.prefetch(path).catch(() => undefined);
   };
   if (pendingFile) prefetchStartup();
   else void storageReady.then(prefetchStartup).catch(() => undefined);
   await app.whenReady();
   const icon = windowIcon();
   const backgroundLinuxTest =
      process.platform === "linux" &&
      process.env["ATTACUT_TESTING"] === "1" &&
      process.env["ATTACUT_HIDDEN"] === "1" &&
      process.env["ATTACUT_NATIVE_SMOKE"] !== "1";
   const window = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 800,
      minHeight: 560,
      show: false,
      ...(backgroundLinuxTest ? { focusable: false, skipTaskbar: true } : {}),
      backgroundColor: "#17191c",
      title: "AttaCut",
      ...(icon ? { icon } : {}),
      titleBarStyle: process.platform === "linux" ? "default" : process.platform === "darwin" ? "hiddenInset" : "hidden",
      webPreferences: {
         preload: join(currentDirectory, "../preload/index.cjs"),
         sandbox: true,
         contextIsolation: true,
         nodeIntegration: false,
         // Hidden test windows must still decode video and run animation callbacks.
         ...(process.env["ATTACUT_TESTING"] === "1" && process.env["ATTACUT_HIDDEN"] === "1" ? { backgroundThrottling: false } : {}),
      },
   });
   appWindow = window;
   // The test harness maps an inactive window for compositing. Hiding it again
   // stops Linux screenshot capture and OffscreenCanvas presentation under Xvfb.
   const testing = !isPackagedApp() && process.env["ATTACUT_TESTING"] === "1" ? new IpcTestAdapter() : null;
   let onExportProgress: ((job: ExportJob) => void) | null = null;
   const exportsService = new ExportService(
      (job) => {
         if (!window.isDestroyed()) window.webContents.send(IpcEvents.jobProgress, job);
         onExportProgress?.(job);
      },
      testing ? (signal) => testing.invoke("test:export-item", () => undefined, signal) : undefined
   );
   if (process.platform === "win32" && icon) {
      // Taskbar relaunches must show the splash too, so they go through the launcher.
      window.setAppDetails({
         appId: "dev.attacut.app",
         appIconPath: icon,
         appIconIndex: 0,
         relaunchDisplayName: "AttaCut",
         relaunchCommand: isPackagedApp() ? `"${launcherPath()}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      });
   }
   window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
   window.webContents.on("will-navigate", (event) => event.preventDefault());
   // Show once the renderer's first UI frame is on screen. ready-to-show is not enough: it
   // fires while the page can still be an empty root element, which reads as a flash of
   // blank window between the splash and the app. The timer only covers a renderer that
   // never reports in.
   let presented = false;
   const presentWindow = () => {
      if (presented) return;
      presented = true;
      if (process.env["ATTACUT_HIDDEN"] !== "1") {
         if (process.env["ATTACUT_TESTING"] === "1" && process.env["ATTACUT_TEST_INACTIVE"] === "1") window.showInactive();
         else {
            window.show();
            window.focus();
            window.webContents.focus();
         }
      }
      registerWindowsIdentity();
      // The launcher's native splash gives way to the app's own startup screen.
      releaseSplash();
   };
   ipcMain.on(IpcEvents.rendererReady, (event) => {
      if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) presentWindow();
   });
   setTimeout(() => {
      if (!window.isDestroyed()) presentWindow();
   }, 2500);
   await storageReady;
   const previewFolder = resolve(app.getPath("userData"), "previews");
   // Keep recent previews across sessions and sweep interrupted runs; preview writers wait for this below.
   const previewCleanup = Promise.all([prunePreviews(previewFolder), pruneWaveforms(resolve(app.getPath("userData"), "waveforms"), undefined, true)]).then(
      () => undefined
   );
   void previewCleanup.catch(() => undefined);
   const sourceSession = new SourceSession(previewFolder, previewCleanup, sourceProbe);
   // Deny-by-default for renderer permissions; nothing in the app currently requests any.
   session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(contents === window.webContents && permission === "fullscreen")
   );
   session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === "fullscreen");
   // The renderer owns fullscreen state for its custom player overlay; native exits
   // (macOS Escape, system gestures) are pushed back so the overlay follows along.
   const notifyFullscreen = (value: boolean) => {
      if (!window.isDestroyed()) window.webContents.send(IpcEvents.windowFullscreen, value);
   };
   window.on("enter-full-screen", () => notifyFullscreen(true));
   window.on("leave-full-screen", () => notifyFullscreen(false));
   protocol.handle("media", async (request) => {
      const url = new URL(request.url);
      if (url.host === "stream") return streamResponse(sourceSession, url, request.signal);
      const id = url.pathname.slice(1);
      const path = sourceSession.mediaPaths.get(id);
      return path ? serveMedia(path, request) : new Response("Not found", { status: 404 });
   });
   protocol.handle("app", (request) => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const root = resolve(currentDirectory, "../renderer");
      const target = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!target.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`)) return new Response("Not found", { status: 404 });
      return net.fetch(pathToFileURL(target).toString());
   });
   let confirmedClose = false;
   let quittingForUpdate = false;
   let closing = false;
   let resolveFlush: ((proceed: boolean) => void) | null = null;
   let rejectFlush: ((error: Error) => void) | null = null;
   let flushTimer: ReturnType<typeof setTimeout> | null = null;
   const disarmFlush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
   };
   // A save dialog can stay open as long as the user needs. The initial timer only
   // guards delivery of the flush request; renderer loss is handled separately.
   const failFlush = () => {
      disarmFlush();
      const reject = rejectFlush;
      resolveFlush = null;
      rejectFlush = null;
      reject?.(new Error("The editor did not finish saving. Try closing again."));
   };
   ipcMain.on(IpcEvents.flushStarted, (event) => {
      if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && flushTimer) {
         disarmFlush();
      }
   });
   window.webContents.on("render-process-gone", failFlush);
   window.webContents.on("destroyed", failFlush);
   /** Resolves false when the editor cancels, for example from its unsaved-project prompt. */
   const flushRenderer = (): Promise<boolean> => {
      if (!rendererReady || window.webContents.isDestroyed()) return Promise.resolve(true);
      return new Promise<boolean>((resolve, reject) => {
         flushTimer = setTimeout(failFlush, 10000);
         resolveFlush = (proceed) => {
            disarmFlush();
            resolveFlush = null;
            rejectFlush = null;
            resolve(proceed);
         };
         rejectFlush = reject;
         window.webContents.send(IpcEvents.flush);
      });
   };
   /** Stop helper processes, bounded so a stuck child cannot hold the app open. */
   const teardown = (limit: number) => {
      sourceProbe.cancelPrefetch();
      sourceSession.dispose();
      exportsService.cancelPlanning();
      exportsService.cancel();
      // Killed children get a bounded window for their cleanup handlers, so temporary
      // export folders are removed instead of stranded beside the user's output.
      return Promise.race([
         Promise.all([exportsService.waitForIdle(), sourceSession.waitForWaveformIdle()]),
         new Promise((resolve) => setTimeout(resolve, limit)),
      ]).catch(() => undefined);
   };
   window.on("close", (event) => {
      if (confirmedClose) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      void (async () => {
         if (exportsService.running) {
            const { response } = await dialog.showMessageBox(window, {
               type: "question",
               message: "Cancel the unfinished export and close?",
               detail: "Finished files will be kept.",
               buttons: ["Keep exporting", "Cancel and close"],
               defaultId: 0,
               cancelId: 0,
            });
            if (response !== 1) return;
         }
         // The renderer may still ask about an unsaved project, so it stays visible until then.
         if (!(await flushRenderer())) return;
         if (exportsService.running) {
            // Closing feels instant: the window fades to a spinner while the export stops.
            await fadeForExit(window);
            exportsService.cancel();
            await exportsService.waitForIdle();
         }
         await storage.flush();
         confirmedClose = true;
         window.close();
      })()
         .catch((error: unknown) => {
            dialog.showErrorBox("Could not save before closing", error instanceof Error ? error.message : String(error));
         })
         .finally(() => {
            closing = false;
         });
   });
   app.on("window-all-closed", () => {
      // An update restart already tore everything down before handing over to the installer.
      if (quittingForUpdate) return;
      void teardown(15_000).finally(() => app.quit());
   });
   await recentReady;
   const clearRecent = () => void recent.clear().catch(() => undefined);
   installMenu(window, recent.files, clearRecent);
   // Linux uses the in-app menus; the native frame must not add a second menu bar.
   if (process.platform === "linux") window.removeMenu();
   recent.onChange((files) => {
      // Rebuilding the application menu on Linux would re-add the native menu bar.
      if (process.platform !== "linux") installMenu(window, files, clearRecent);
      if (!window.isDestroyed()) window.webContents.send(IpcEvents.recentChanged);
      // The Windows jump list and the macOS Dock menu follow the same history.
      if (process.platform !== "linux") {
         app.clearRecentDocuments();
         for (const file of [...files].reverse()) app.addRecentDocument(file.path);
      }
   });
   const updateLog = createUpdateLog(app.getPath("logs"));
   const updates = new UpdateManager(
      (status) => {
         if (!window.isDestroyed()) window.webContents.send(IpcEvents.updateStatus, status);
      },
      (message) => updateLog.info(message)
   );
   const userData = app.getPath("userData");
   // A launch that still runs the version which started an install means it did not apply.
   const installOutcome = takeInstallOutcome(userData, app.getVersion())
      .then((outcome): AvailableUpdate | null => {
         if (!outcome) return null;
         updateLog.info(
            outcome.applied ? `Started after installing ${outcome.targetVersion}` : `${outcome.targetVersion} did not apply; still ${app.getVersion()}`
         );
         if (outcome.applied) return null;
         const version = outcome.targetVersion;
         return {
            version,
            name: `AttaCut ${version}`,
            url: `https://github.com/NoomStuff/AttaCut/releases/tag/v${version}`,
            mode: "releases",
            notApplied: true,
         };
      })
      .catch(() => null);
   let outcomeTaken = false;
   let restart: { cancel: () => void } | null = null;
   const exportPercent = (job: ExportJob | null) => {
      if (!job?.items.length) return null;
      const weight = (item: ExportJob["items"][number]) => item.duration ?? 1;
      const finished = (item: ExportJob["items"][number]) => ["completed", "failed", "cancelled"].includes(item.status);
      const done = job.items.reduce((sum, item) => sum + weight(item) * (finished(item) ? 1 : item.progress), 0);
      return Math.round((done / job.items.reduce((sum, item) => sum + weight(item), 0)) * 100);
   };
   /**
    * An explicit "Restart to update" is not an accidental quit: a running export finishes,
    * with its progress in the update chip, instead of prompting to cancel it. Only unsaved
    * project changes still ask. Teardown completes before quitAndInstall, so the silent
    * installer never waits on, or has to kill, a process that is still shutting down.
    */
   const restartToUpdate = () => {
      const target = updates.readyUpdate;
      if (restart || !target) return;
      const clicked = Date.now();
      let cancelled = false;
      let wake = () => {};
      restart = {
         cancel: () => {
            cancelled = true;
            wake();
         },
      };
      const installing = (percent: number | null, waitingFor?: "export") =>
         updates.emit({ phase: "installing", version: target.version, percent, ...(waitingFor ? { waitingFor } : {}) });
      const ready = () => updates.emit({ phase: "ready", version: target.version, percent: 100 });
      let handedOver = false;
      void (async () => {
         onExportProgress = (job) => {
            if (job.running) installing(exportPercent(job), "export");
         };
         while (exportsService.running && !cancelled) {
            installing(exportPercent(exportsService.current), "export");
            await Promise.race([
               exportsService.waitForIdle(),
               new Promise<void>((resolve) => {
                  wake = resolve;
               }),
            ]);
         }
         onExportProgress = null;
         if (cancelled) return ready();
         installing(null);
         if (!(await flushRenderer())) return ready();
         await storage.flush();
         confirmedClose = true;
         quittingForUpdate = true;
         handedOver = true;
         // The editor state is saved. Closing ends the renderer, so teardown has no live page
         // starting new preview or waveform work; window-all-closed leaves the quit to us.
         window.close();
         await teardown(5_000);
         await writeInstallRecord(userData, { fromVersion: app.getVersion(), targetVersion: target.version });
         updateLog.info(`Handing over to the installer ${Date.now() - clicked}ms after Restart to update`);
         updates.install();
         // quitAndInstall quits on the next tick. If it could not start the installer, still
         // close: the install record makes the next launch report that the update did not apply.
         setTimeout(() => app.quit(), 10_000).unref();
      })()
         .catch(async (error: unknown) => {
            updateLog.error(error);
            onExportProgress = null;
            if (handedOver) return app.quit();
            await clearInstallRecord(userData).catch(() => undefined);
            updates.emit({
               phase: "error",
               version: target.version,
               percent: null,
               message: "Could not restart to update. Open the release to update manually.",
            });
         })
         .finally(() => {
            restart = null;
         });
   };
   registerIpc({
      testing,
      updates,
      window,
      storage,
      recent,
      sourceSession,
      exportsService,
      takeInitialFile: () => {
         rendererReady = true;
         const file = pendingFile;
         pendingFile = null;
         return file;
      },
      onFlushed: (proceed = true) => {
         resolveFlush?.(proceed);
      },
      onRestartToUpdate: restartToUpdate,
      onCancelUpdateRestart: () => restart?.cancel(),
      takeUpdateOutcome: async () => {
         const outcome = await installOutcome;
         if (outcomeTaken) return null;
         outcomeTaken = true;
         return outcome;
      },
   });
   ipcMain.on(IpcEvents.windowAction, (event, value: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
      if (value === "minimize") window.minimize();
      if (value === "maximize") {
         if (window.isMaximized()) window.unmaximize();
         else window.maximize();
      }
      if (value === "close") window.close();
      // Fullscreen takes over the whole screen; the custom player controls stay in-window.
      if (value === "enterFullscreen") {
         if (!window.isFullScreen()) window.setFullScreen(true);
         // Activate after the Windows fullscreen resize, so the shell treats this
         // window as the foreground fullscreen app and lowers the taskbar.
         if (process.platform === "win32" && process.env["ATTACUT_HIDDEN"] !== "1") {
            window.moveTop();
            window.focus();
         }
      }
      if (value === "exitFullscreen" && window.isFullScreen()) window.setFullScreen(false);
   });
   // External launchers can pass their own dev server URL through the environment.
   if (!isPackagedApp() && process.env["ELECTRON_RENDERER_URL"]) await window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
   else await window.loadURL("app://editor/index.html");
}
if (!ownsInstance) app.quit();
else
   void start().catch((error: unknown) => {
      sourceProbe.cancelPrefetch();
      console.error(error);
      // Hidden test windows cannot show this box sensibly: a native dialog from an
      // invisible process dangles on the user's screen, so tests fail in the log only.
      if (process.env["ATTACUT_TESTING"] === "1") {
         app.exit(1);
         return;
      }
      dialog.showErrorBox("Could not start AttaCut", error instanceof Error ? error.message : String(error));
      app.exit(1);
   });
