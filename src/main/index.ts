import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { preferencesSchema, planRequestSchema, savedSessionSchema, frameRequestSchema } from "../shared/types.ts";
import { probeSource, sourceKeyframes } from "./media/probe.ts";
import { exportFrame } from "./media/frame.ts";
import type { ProbedSource } from "./media/probe.ts";
import { preparePreview } from "./media/preview.ts";
import { ExportService } from "./exports.ts";
import { Storage } from "./storage.ts";
import { serveMedia } from "./media/serve.ts";
import { videoExtensions } from "./media/formats.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
// Dev runs from out/main, so the unpackaged icons live two levels up; packaged builds
// embed the exe/bundle icon and need no window icon.
function windowIcon(): string | undefined {
   if (process.platform === "darwin") return undefined;
   const name = process.platform === "win32" ? "icon.ico" : "icon.png";
   const icon = resolve(currentDirectory, "../../build", name);
   return existsSync(icon) ? icon : undefined;
}
app.setName("AttaCut");
if (process.platform === "win32") app.setAppUserModelId("dev.attacut.app");
app.commandLine.appendSwitch("enable-blink-features", "AudioVideoTracks");
protocol.registerSchemesAsPrivileged([
   { scheme: "media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
   { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (process.env["ATTACUT_USER_DATA"]) app.setPath("userData", process.env["ATTACUT_USER_DATA"]);
async function start(): Promise<void> {
   let sourceController: AbortController | null = null;
   let previewController: AbortController | null = null;
   const sources = new Map<string, ProbedSource>();
   const mediaPaths = new Map<string, string>();
   const keyframes = new Map<string, number[]>();
   const frameOutputs = new Set<string>();
   const exportsService = new ExportService((job) => {
      if (!window.isDestroyed()) window.webContents.send("export:progress", job);
   });
   function validSender(event: IpcMainInvokeEvent): void {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Invalid application request.");
   }
   function handle(channel: string, action: (value: unknown) => unknown): void {
      ipcMain.handle(channel, (event, value: unknown) => {
         validSender(event);
         return action(value);
      });
   }
   function getSource(value: unknown): ProbedSource {
      const source = sources.get(z.string().parse(value));
      if (!source) throw new Error("Reopen the source video.");
      return source;
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
               item("Export clips…", "export"),
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
         { label: "Help", submenu: [item("Keyboard shortcuts", "shortcuts")] },
      ];
      if (process.platform === "darwin") template.unshift({ role: "appMenu" });
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
   }

   await app.whenReady();
   const storage = new Storage(app.getPath("userData"));
   await storage.load();
   const previewFolder = resolve(app.getPath("userData"), "previews");
   if (resolve(previewFolder, "..") !== resolve(app.getPath("userData"))) throw new Error("Invalid preview cache path.");
   await rm(previewFolder, { recursive: true, force: true });
   session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(contents === window.webContents && permission === "fullscreen")
   );
   session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === "fullscreen");
   protocol.handle("media", async (request) => {
      const id = new URL(request.url).pathname.slice(1);
      const path = mediaPaths.get(id);
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
   window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
   window.webContents.on("will-navigate", (event) => event.preventDefault());
   window.once("ready-to-show", () => {
      if (process.env["ATTACUT_HIDDEN"] !== "1") window.show();
   });
   let confirmedClose = false;
   window.on("close", (event) => {
      if (exportsService.running && !confirmedClose) {
         event.preventDefault();
         void dialog
            .showMessageBox(window, {
               type: "question",
               message: "Cancel the unfinished export and close?",
               detail: "Clips already exported will be kept.",
               buttons: ["Keep exporting", "Cancel and close"],
               defaultId: 0,
               cancelId: 0,
            })
            .then(({ response }) => {
               if (response === 1) {
                  confirmedClose = true;
                  exportsService.cancel();
                  void exportsService.waitForIdle().then(() => window.close());
               }
            });
      }
   });
   app.on("window-all-closed", () => {
      sourceController?.abort();
      previewController?.abort();
      exportsService.cancel();
      app.quit();
   });
   installMenu();
   handle("app:bootstrap", () => ({
      preferences: storage.preferences,
      session: storage.session,
      platform: process.platform,
      version: app.getVersion(),
      initialFile:
         process.env["ATTACUT_OPEN_FILE"] ??
         process.argv.slice(1).find((arg) => videoExtensions.some((extension) => arg.toLowerCase().endsWith(`.${extension}`)) && existsSync(arg)) ??
         null,
   }));
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
      sourceController?.abort();
      previewController?.abort();
      sourceController = new AbortController();
      const source = await probeSource(z.string().min(1).parse(value), sourceController.signal);
      sources.set(source.id, source);
      mediaPaths.set(source.id, source.path);
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
      const source = getSource(value);
      const cached = keyframes.get(source.id);
      if (cached) return cached;
      const points = await sourceKeyframes(source, sourceController?.signal);
      keyframes.set(source.id, points);
      return points;
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
      const request = z.object({ sourceId: z.string(), audioIndex: z.number().int().nullable(), transcode: z.boolean() }).parse(value);
      const source = getSource(request.sourceId);
      if (request.audioIndex !== null && !source.streams.some((stream) => stream.type === "audio" && stream.index === request.audioIndex))
         throw new Error("Audio track not found.");
      previewController?.abort();
      const controller = new AbortController();
      previewController = controller;
      const { id, path } = await preparePreview(source, previewFolder, request.audioIndex, request.transcode, {
         signal: controller.signal,
         onProgress: (progress) => {
            if (!window.isDestroyed()) window.webContents.send("preview:progress", { sourceId: source.id, progress, running: true });
         },
      });
      mediaPaths.set(id, path);
      window.webContents.send("preview:progress", { sourceId: source.id, progress: 1, running: false });
      return `media://source/${id}`;
   });
   handle("preview:cancel", () => {
      previewController?.abort();
   });
   handle("export:plan", (value) => {
      const request = planRequestSchema.parse(value);
      return exportsService.plan(getSource(request.sourceId), request);
   });
   handle("export:start", (value) => exportsService.start(z.string().parse(value)));
   handle("export:cancel", () => exportsService.cancel());
   handle("export:retry", (value) => exportsService.retry(z.string().parse(value)));
   handle("output:reveal", (value) => {
      const path = z.string().parse(value);
      if (frameOutputs.has(path)) {
         shell.showItemInFolder(path);
         return;
      }
      const job = exportsService.current;
      if (!job || !(path === job.directory || job.items.some((item) => item.outputPath === path))) throw new Error("Output not found.");
      if (path === job.directory) return shell.openPath(path);
      shell.showItemInFolder(path);
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
void start().catch((error: unknown) => {
   console.error(error);
   dialog.showErrorBox("Could not start AttaCut", error instanceof Error ? error.message : String(error));
   app.exit(1);
});
