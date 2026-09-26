import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from "electron";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { SourceSession } from "./source-session.ts";
import { ExportService } from "./exports.ts";
import { Storage } from "./storage.ts";
import { serveMedia } from "./media/serve.ts";
import { videoExtensions } from "./media/formats.ts";
import { prunePreviews } from "./media/preview.ts";
import { IpcEvents } from "../shared/ipc.ts";
import { installMenu } from "./menu.ts";
import { windowIcon, registerWindowsIdentity } from "./identity.ts";
import { registerIpc } from "./ipc.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
if (process.env["ATTACUT_USER_DATA"]) app.setPath("userData", process.env["ATTACUT_USER_DATA"]);
const ownsInstance = app.requestSingleInstanceLock();
let appWindow: BrowserWindow | null = null;
let rendererReady = false;
const fileArgument = (args: string[]): string | null =>
   args.find((arg) => videoExtensions.some((extension) => arg.toLowerCase().endsWith(`.${extension}`)) && existsSync(arg)) ?? null;
let pendingFile = process.env["ATTACUT_OPEN_FILE"] ?? fileArgument(process.argv.slice(1));
const receiveFile = (path: string | null) => {
   if (path && rendererReady && appWindow && !appWindow.isDestroyed()) appWindow.webContents.send(IpcEvents.openFile, path);
   else if (path) pendingFile = path;
   if (appWindow && !appWindow.isDestroyed()) {
      if (appWindow.isMinimized()) appWindow.restore();
      appWindow.show();
      appWindow.focus();
   }
};
app.on("second-instance", (_event, args) => receiveFile(fileArgument(args.slice(1))));
app.on("open-file", (event, path) => {
   event.preventDefault();
   receiveFile(path);
});
app.setName("AttaCut");
if (process.platform === "win32") app.setAppUserModelId("dev.attacut.app");
app.commandLine.appendSwitch("enable-blink-features", "AudioVideoTracks");
protocol.registerSchemesAsPrivileged([
   { scheme: "media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
   { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
async function start(): Promise<void> {
   // The read is small, but starting it here overlaps it with app and window init; IPC
   // handlers that answer from storage go live only after it resolves below.
   const storage = new Storage(app.getPath("userData"));
   const storageReady = storage.load();
   await app.whenReady();
   const icon = windowIcon();
   const window = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 800,
      minHeight: 560,
      show: false,
      backgroundColor: "#17191c",
      title: "AttaCut",
      ...(icon ? { icon } : {}),
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      webPreferences: {
         preload: join(currentDirectory, "../preload/index.cjs"),
         sandbox: true,
         contextIsolation: true,
         nodeIntegration: false,
      },
   });
   appWindow = window;
   const exportsService = new ExportService((job) => {
      if (!window.isDestroyed()) window.webContents.send(IpcEvents.jobProgress, job);
   });
   if (process.platform === "win32" && icon) {
      // Taskbar relaunches must show the splash too, so they go through the launcher
      // whenever it fronts the renamed Electron executable.
      const launcherExe = join(dirname(process.execPath), "AttaCut.exe");
      const relaunchExe = basename(process.execPath) === "AttaCut-app.exe" && existsSync(launcherExe) ? launcherExe : process.execPath;
      window.setAppDetails({
         appId: "dev.attacut.app",
         appIconPath: icon,
         appIconIndex: 0,
         relaunchDisplayName: "AttaCut",
         relaunchCommand: app.isPackaged ? `"${relaunchExe}"` : `"${process.execPath}" "${app.getAppPath()}"`,
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
      if (process.env["ATTACUT_HIDDEN"] !== "1") window.show();
      registerWindowsIdentity();
      // The dev launcher's native splash watches for this file and closes itself.
      const splashSignal = process.env["ATTACUT_SPLASH_SIGNAL"];
      if (splashSignal) void writeFile(splashSignal, "1").catch(() => undefined);
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
   const previewCleanup = prunePreviews(previewFolder);
   void previewCleanup.catch(() => undefined);
   const sourceSession = new SourceSession(previewFolder, previewCleanup);
   session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(contents === window.webContents && permission === "fullscreen")
   );
   session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === "fullscreen");
   protocol.handle("media", async (request) => {
      const id = new URL(request.url).pathname.slice(1);
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
   let closing = false;
   let resolveFlush: (() => void) | null = null;
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
            exportsService.cancel();
            await exportsService.waitForIdle();
         }
         if (rendererReady && !window.webContents.isDestroyed()) {
            await new Promise<void>((resolve, reject) => {
               const timer = setTimeout(() => {
                  resolveFlush = null;
                  reject(new Error("The editor did not finish saving. Try closing again."));
               }, 10000);
               resolveFlush = () => {
                  clearTimeout(timer);
                  resolve();
               };
               window.webContents.send(IpcEvents.flush);
            });
         }
         await storage.flush();
         confirmedClose = true;
         window.close();
      })()
         .catch((error: unknown) => dialog.showErrorBox("Could not save before closing", error instanceof Error ? error.message : String(error)))
         .finally(() => {
            closing = false;
         });
   });
   app.on("window-all-closed", () => {
      sourceSession.dispose();
      exportsService.cancelPlanning();
      exportsService.cancel();
      // Give killed children and their cleanup handlers a bounded window to finish so
      // temporary export folders are removed instead of stranded beside the user's output.
      void Promise.race([exportsService.waitForIdle(), new Promise((resolve) => setTimeout(resolve, 15_000))]).finally(() => app.quit());
   });
   installMenu(window);
   registerIpc({
      window,
      storage,
      sourceSession,
      exportsService,
      takeInitialFile: () => {
         rendererReady = true;
         const file = pendingFile;
         pendingFile = null;
         return file;
      },
      onFlushed: () => {
         resolveFlush?.();
         resolveFlush = null;
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
   });
   if (process.env["ELECTRON_RENDERER_URL"]) await window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
   else await window.loadURL("app://editor/index.html");
}
if (!ownsInstance) app.quit();
else
   void start().catch((error: unknown) => {
      console.error(error);
      dialog.showErrorBox("Could not start AttaCut", error instanceof Error ? error.message : String(error));
      app.exit(1);
   });
