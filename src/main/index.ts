import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { preferencesSchema, planRequestSchema, savedSessionSchema, frameRequestSchema } from "../shared/types.ts";
import { packetsAround } from "./media/probe.ts";
import { exportFrame } from "./media/frame.ts";
import type { ProbedSource } from "./media/probe.ts";
import { SourceSession } from "./source-session.ts";
import { resolveFrameTime } from "../shared/frames.ts";
import { ExportService } from "./exports.ts";
import { Storage } from "./storage.ts";
import { serveMedia } from "./media/serve.ts";
import { videoExtensions } from "./media/formats.ts";
import type { IpcCalls } from "../shared/ipc.ts";
import { fetchAvailableUpdate, updateInterval } from "./updates.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
if (process.env["ATTACUT_USER_DATA"]) app.setPath("userData", process.env["ATTACUT_USER_DATA"]);
const ownsInstance = app.requestSingleInstanceLock();
let appWindow: BrowserWindow | null = null;
let rendererReady = false;
const fileArgument = (args: string[]): string | null =>
   args.find((arg) => videoExtensions.some((extension) => arg.toLowerCase().endsWith(`.${extension}`)) && existsSync(arg)) ?? null;
let pendingFile = process.env["ATTACUT_OPEN_FILE"] ?? fileArgument(process.argv.slice(1));
const receiveFile = (path: string | null) => {
   if (path && rendererReady && appWindow && !appWindow.isDestroyed()) appWindow.webContents.send("app:open-file", path);
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
// Use the same assets for native windows and Windows shell entries in every build.
function windowIcon(): string | undefined {
   if (process.platform === "darwin") return undefined;
   const name = process.platform === "win32" ? "icon.ico" : "icon.png";
   const icon = app.isPackaged ? join(process.resourcesPath, "icons", name) : resolve(currentDirectory, "../../build", name);
   return existsSync(icon) ? icon : undefined;
}
app.setName("AttaCut");
if (process.platform === "win32") app.setAppUserModelId("dev.attacut.app");
function registerWindowsIdentity(): void {
   if (process.platform !== "win32") return;
   // Taskbar and notification surfaces resolve a raw AUMID's label from this registry key;
   // without it they fall back to the executable description, which reads "Electron" for
   // dev runs and portable builds that install no Start Menu shortcut.
   const modelId = "dev.attacut.app";
   const reg = (path: string, value: string, data: string) =>
      spawn("reg", ["add", path, "/v", value, "/t", "REG_SZ", "/d", data, "/f"], { windowsHide: true, stdio: "ignore" }).on("error", () => undefined);
   reg(`HKCU\\Software\\Classes\\AppUserModelId\\${modelId}`, "DisplayName", "AttaCut");
   const icon = windowIcon();
   if (icon) reg(`HKCU\\Software\\Classes\\AppUserModelId\\${modelId}`, "IconUri", icon);
   // A window with no shortcut carrying its AUMID is named after the executable's cached
   // friendly name, which stays "Electron" for the dev electron.exe until relabeled here.
   reg("HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache", `${process.execPath}.FriendlyAppName`, "AttaCut");
}
app.commandLine.appendSwitch("enable-blink-features", "AudioVideoTracks");
protocol.registerSchemesAsPrivileged([
   { scheme: "media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
   { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
async function start(): Promise<void> {
   const frameOutputs = new Set<string>();
   const exportsService = new ExportService((job) => {
      if (!window.isDestroyed()) window.webContents.send("export:progress", job);
   });
   function validSender(event: IpcMainInvokeEvent): void {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Invalid application request.");
   }
   function handle<K extends keyof IpcCalls>(channel: K, action: (value: unknown) => IpcCalls[K]["response"] | Promise<IpcCalls[K]["response"]>): void {
      ipcMain.handle(channel, (event, value: unknown) => {
         validSender(event);
         return action(value);
      });
   }
   function getSource(value: unknown): ProbedSource {
      return sourceSession.get(z.string().parse(value));
   }
   function sendCommand(id: string): void {
      window.webContents.send("app:command", id);
   }
   function installMenu(): void {
      const item = (label: string, id: string) => ({ label, click: () => sendCommand(id) });
      const template: Electron.MenuItemConstructorOptions[] = [
         {
            label: "File",
            submenu: [
               item("Import video…", "open"),
               item("Export current frame…", "frame"),
               item("Export…", "export"),
               { type: "separator" },
               { role: "quit" },
            ],
         },
         { label: "Edit", submenu: [item("Undo", "undo"), item("Redo", "redo"), { type: "separator" }, item("Settings…", "settings")] },
         {
            label: "Clips",
            submenu: [
               item("Merge clips", "merge"),
               item("Split at playhead", "split"),
               item("Trim left", "setStart"),
               item("Trim right", "setEnd"),
               item("Delete clip", "delete"),
               item("Add clip in gap", "add"),
               item("Preview clip", "preview"),
            ],
         },
         {
            label: "View",
            submenu: [
               item("Zoom in", "zoomIn"),
               item("Zoom out", "zoomOut"),
               item("Fit timeline", "fit"),
               { role: "togglefullscreen" },
               ...(!app.isPackaged ? [{ role: "toggleDevTools" as const }] : []),
            ],
         },
         { label: "Help", submenu: [item("Help", "help"), item("Keyboard shortcuts", "shortcuts"), { type: "separator" }, item("About", "about")] },
      ];
      if (process.platform === "darwin") template.unshift({ role: "appMenu" });
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
   }

   await app.whenReady();
   const storage = new Storage(app.getPath("userData"));
   await storage.load();
   const previewFolder = resolve(app.getPath("userData"), "previews");
   if (resolve(previewFolder, "..") !== resolve(app.getPath("userData"))) throw new Error("Invalid preview cache path.");
   // Cleanup can run alongside window loading. Preview writers wait for it below.
   const previewCleanup = rm(previewFolder, { recursive: true, force: true });
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
   if (process.platform === "win32" && icon) {
      window.setAppDetails({
         appId: "dev.attacut.app",
         appIconPath: icon,
         appIconIndex: 0,
         relaunchDisplayName: "AttaCut",
         relaunchCommand: app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`,
      });
   }
   window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
   window.webContents.on("will-navigate", (event) => event.preventDefault());
   window.once("ready-to-show", () => {
      if (process.env["ATTACUT_HIDDEN"] !== "1") window.show();
      registerWindowsIdentity();
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
               window.webContents.send("app:flush");
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
      app.quit();
   });
   installMenu();
   handle("app:bootstrap", () => {
      rendererReady = true;
      const initialFile = pendingFile;
      pendingFile = null;
      return {
         warning: storage.warning,
         preferences: storage.preferences,
         session: storage.session,
         platform: process.platform,
         version: app.getVersion(),
         initialFile,
      };
   });
   handle("update:check", async () => {
      if (!app.isPackaged || Date.now() - storage.updates.lastCheckedAt < updateInterval) return null;
      storage.updates = { ...storage.updates, lastCheckedAt: Date.now() };
      await storage.save();
      try {
         const update = await fetchAvailableUpdate(app.getVersion(), (url, init) => net.fetch(url, init));
         return update?.version === storage.updates.ignoredVersion ? null : update;
      } catch {
         return null;
      }
   });
   handle("update:dismiss", async (value) => {
      const choice = z.object({ version: z.string().min(1), ignore: z.boolean() }).parse(value);
      if (choice.ignore) storage.updates = { ...storage.updates, ignoredVersion: choice.version };
      await storage.save();
   });
   handle("source:choose", async () => {
      const result = await dialog.showOpenDialog(window, {
         title: "Import video",
         properties: ["openFile"],
         filters: [
            { name: "Video", extensions: videoExtensions },
            { name: "All files", extensions: ["*"] },
         ],
      });
      return result.filePaths[0] ?? null;
   });
   handle("source:open", async (value) => {
      const source = await sourceSession.open(z.string().min(1).parse(value));
      exportsService.cancelPlanning();
      frameOutputs.clear();
      window.setTitle(`${source.name} — AttaCut`);
      return source;
   });
   handle("directory:choose", async (value) => {
      const current = z.string().parse(value);
      const result = await dialog.showOpenDialog(window, {
         properties: ["openDirectory", "createDirectory"],
         ...(current ? { defaultPath: current } : {}),
      });
      return result.filePaths[0] ?? null;
   });
   handle("source:keyframes", async (value) => {
      return sourceSession.keyframes(z.string().parse(value));
   });
   handle("source:frame-time", async (value) => {
      const request = z
         .object({ sourceId: z.string(), time: z.number().finite().nonnegative(), direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]) })
         .parse(value);
      const source = getSource(request.sourceId);
      const points = await packetsAround(source, request.time, sourceSession.signal);
      return resolveFrameTime(
         points.map((point) => point.time),
         request.time,
         source.duration,
         request.direction
      );
   });
   handle("audio:scrub", async (value) => {
      const { sourceId, streamIndices, time } = z
         .object({ sourceId: z.string(), streamIndices: z.array(z.number().int()).min(1), time: z.number().finite().nonnegative().default(0) })
         .parse(value);
      const source = getSource(sourceId);
      if (streamIndices.some((index) => !source.streams.some((stream) => stream.type === "audio" && stream.index === index)))
         throw new Error("Audio track not found.");
      return sourceSession.scrubAudio(source.id, streamIndices, time);
   });
   handle("audio:cancel", () => sourceSession.cancelScrub());
   handle("export:cancel-planning", () => exportsService.cancelPlanning());
   handle("state:flush", async (value) => {
      const snapshot = z.object({ preferences: preferencesSchema, session: savedSessionSchema.nullable() }).parse(value);
      storage.preferences = snapshot.preferences;
      storage.session = snapshot.session;
      await storage.save();
      resolveFlush?.();
      resolveFlush = null;
   });
   handle("frame:export", async (value) => {
      const request = frameRequestSchema.parse(value);
      const path = await exportFrame(getSource(request.sourceId), request);
      frameOutputs.add(path);
      return path;
   });
   handle("preferences:save", async (value) => {
      storage.preferences = preferencesSchema.parse(value);
      await storage.save();
   });
   handle("session:save", async (value) => {
      storage.session = savedSessionSchema.parse(value);
      await storage.save();
   });
   handle("session:clear", async () => {
      storage.session = null;
      await storage.save();
   });
   handle("preview:prepare", async (value) => {
      const request = z.object({ sourceId: z.string(), audioIndices: z.array(z.number().int()), transcode: z.boolean() }).parse(value);
      const source = getSource(request.sourceId);
      if (request.audioIndices.some((index) => !source.streams.some((stream) => stream.type === "audio" && stream.index === index)))
         throw new Error("Audio track not found.");
      return sourceSession.prepare(source.id, request.audioIndices, request.transcode);
   });
   handle("preview:cancel", () => {
      sourceSession.cancelPreview();
   });
   handle("export:plan", (value) => {
      const request = planRequestSchema.parse(value);
      return exportsService.plan(getSource(request.sourceId), request);
   });
   handle("export:check-destinations", (value) => {
      const request = planRequestSchema.parse(value);
      return exportsService.checkDestinations(getSource(request.sourceId), request);
   });
   handle("export:analyze", (value) => {
      const request = planRequestSchema.parse(value);
      return exportsService.inspect(getSource(request.sourceId), request);
   });
   handle("export:start", (value) => {
      const request = z
         .object({
            id: z.string(),
            approval: z
               .object({ createDirectory: z.boolean().optional(), overwrite: z.boolean().optional(), replaceSource: z.boolean().optional() })
               .optional(),
         })
         .parse(value);
      return exportsService.start(request.id, request.approval);
   });
   handle("export:cancel", () => exportsService.cancel());
   handle("export:retry", (value) => exportsService.retry(z.string().parse(value)));
   handle("output:open", async (value) => {
      const path = z.string().parse(value);
      if (!exportsService.current?.items.some((item) => item.outputPath === path && item.status === "completed")) throw new Error("Exported file not found.");
      const failure = await shell.openPath(path);
      if (failure) throw new Error(failure);
   });
   handle("output:reveal", async (value) => {
      const path = z.string().parse(value);
      if (frameOutputs.has(path)) {
         shell.showItemInFolder(path);
         return;
      }
      const job = exportsService.current;
      if (!job || !job.items.some((item) => item.outputPath === path && item.status === "completed")) throw new Error("Output not found.");
      shell.showItemInFolder(path);
   });
   // The renderer only ever opens links to project-owned sites; the allowlist keeps a
   // compromised page from reaching shell.openExternal with arbitrary targets.
   const externalHosts = new Set(["github.com", "noomstuff.com"]);
   handle("open:external", (value) => {
      const url = new URL(z.string().parse(value));
      if (url.protocol !== "https:" || !externalHosts.has(url.hostname)) throw new Error("That link cannot be opened.");
      return shell.openExternal(url.href);
   });
   handle("notices:open", async () => {
      const path = app.isPackaged ? join(process.resourcesPath, "THIRD_PARTY_NOTICES.md") : resolve(currentDirectory, "../../THIRD_PARTY_NOTICES.md");
      if (!existsSync(path)) throw new Error("The third-party notices file is missing from this installation.");
      const failure = await shell.openPath(path);
      if (failure) throw new Error(failure);
   });
   ipcMain.on("window:action", (event, value: unknown) => {
      if (event.sender !== window.webContents) return;
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
