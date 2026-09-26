import { app, dialog, ipcMain, net, shell, type BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
   preferencesSchema,
   planRequestSchema,
   savedSessionSchema,
   frameRequestSchema,
   frameTimeRequestSchema,
   scrubRequestSchema,
   previewRequestSchema,
   exportApprovalSchema,
   analyzeRequestSchema,
} from "../shared/types.ts";
import type { IpcCalls } from "../shared/ipc.ts";
import { exportFrame } from "./media/frame.ts";
import { videoExtensions } from "./media/formats.ts";
import { fetchAvailableUpdate, updateInterval } from "./updates.ts";
import type { SourceSession } from "./source-session.ts";
import type { ExportService } from "./exports.ts";
import type { Storage } from "./storage.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));

export function registerIpc({
   window,
   storage,
   sourceSession,
   exportsService,
   takeInitialFile,
   onFlushed,
}: {
   window: BrowserWindow;
   storage: Storage;
   sourceSession: SourceSession;
   exportsService: ExportService;
   takeInitialFile: () => string | null;
   onFlushed: () => void;
}): void {
   const frameOutputs = new Set<string>();
   const getSource = (id: string) => sourceSession.get(id);
   function handle<K extends keyof IpcCalls>(channel: K, action: (value: unknown) => IpcCalls[K]["response"] | Promise<IpcCalls[K]["response"]>): void {
      ipcMain.handle(channel, (event, value: unknown) => {
         if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Invalid application request.");
         return action(value);
      });
   }
   handle("app:bootstrap", () => {
      const initialFile = takeInitialFile();
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
      try {
         const update = await fetchAvailableUpdate(app.getVersion(), (url, init) => net.fetch(url, init));
         // Only a completed check suppresses the next one; a failed network call retries next launch.
         storage.updates = { ...storage.updates, lastCheckedAt: Date.now() };
         await storage.save();
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
      const request = frameTimeRequestSchema.parse(value);
      return sourceSession.frameTime(request.sourceId, request.time, request.direction);
   });
   handle("audio:scrub", async (value) => {
      const request = scrubRequestSchema.parse(value);
      const source = getSource(request.sourceId);
      if (request.streamIndices.some((index) => !source.streams.some((stream) => stream.type === "audio" && stream.index === index)))
         throw new Error("Audio track not found.");
      return sourceSession.scrubAudio(source.id, request.streamIndices, request.time);
   });
   handle("audio:cancel", () => sourceSession.cancelScrub());
   handle("export:cancel-planning", () => exportsService.cancelPlanning());
   handle("state:flush", async (value) => {
      const snapshot = z.object({ preferences: preferencesSchema, session: savedSessionSchema.nullable() }).parse(value);
      storage.preferences = snapshot.preferences;
      storage.session = snapshot.session;
      await storage.save();
      onFlushed();
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
   handle("preview:prepare", async (value) => {
      const request = previewRequestSchema.parse(value);
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
      const request = analyzeRequestSchema.parse(value);
      return exportsService.inspect(getSource(request.sourceId), request);
   });
   handle("export:start", (value) => {
      const request = z.object({ id: z.string(), approval: exportApprovalSchema.optional() }).parse(value);
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
}
