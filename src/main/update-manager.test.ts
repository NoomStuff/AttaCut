import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { app, net } from "electron";
import type * as NodeFs from "node:fs";
import { UpdateManager, fetchAvailableUpdate } from "./updates";

vi.mock("electron", () => ({ app: { getVersion: () => "0.14.1", getPath: vi.fn() }, net: { fetch: vi.fn() } }));
vi.mock("./identity", () => ({ isPackagedApp: () => true }));
vi.mock("node:fs", async (original) => {
   const actual = await original<typeof NodeFs>();
   return { ...actual, existsSync: (path: string) => path.endsWith("app-update.yml") || actual.existsSync(path) };
});
const automatic = await vi.hoisted(async () => {
   const { EventEmitter } = await import("node:events");
   return Object.assign(new EventEmitter(), { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn() });
});
vi.mock("electron-updater", () => ({ autoUpdater: automatic }));
const folders: string[] = [];
afterEach(async () => {
   vi.unstubAllEnvs();
   vi.resetAllMocks();
   automatic.removeAllListeners();
   for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
const release = { version: "0.15.0", name: "next", url: "https://example.com/release", mode: "releases" as const };
function manager() {
   const send = vi.fn();
   return { manager: new UpdateManager({ isDestroyed: () => false, webContents: { send } } as unknown as BrowserWindow), send };
}
it.each([404, 429, 500])("reports HTTP %s during release checks", async (status) => {
   await expect(fetchAvailableUpdate("0.14.1", async () => new Response("", { status }))).rejects.toThrow(String(status));
});
it.each([{}, { tag_name: 123 }, { tag_name: "0.15.0", name: null, html_url: "bad", draft: false, prerelease: false }])(
   "rejects malformed releases %j",
   async (value) => {
      await expect(fetchAvailableUpdate("0.14.1", async () => Response.json(value))).rejects.toThrow();
   }
);
it.each(["draft", "prerelease"])("ignores %s releases", async (field) => {
   expect(
      await fetchAvailableUpdate("0.14.1", async () =>
         Response.json({ tag_name: "0.15.0", name: null, html_url: release.url, draft: false, prerelease: false, [field]: true })
      )
   ).toBeNull();
});
it.skipIf(process.platform === "darwin")("handles automatic progress, readiness, install and errors", async () => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "");
   vi.stubEnv("APPIMAGE", "/test/app");
   Object.defineProperty(process, "resourcesPath", { value: tmpdir(), configurable: true });
   automatic.checkForUpdates.mockResolvedValue({});
   const { manager: updates, send } = manager();
   expect(() => updates.install()).toThrow("not ready");
   await updates.offer(release);
   await vi.waitFor(() => expect(automatic.checkForUpdates).toHaveBeenCalled());
   automatic.emit("download-progress", { percent: 42.3 });
   expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "downloading", percent: 42 }));
   automatic.emit("error", new Error("network lost"));
   expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "error" }));
   automatic.emit("update-downloaded");
   expect(updates.isReady).toBe(true);
   updates.install();
   expect(automatic.quitAndInstall).toHaveBeenCalledWith(false, true);
});
it.skipIf(process.platform !== "win32").each(["checksum", "interrupted", "http", "malformed", "success"])("portable download: %s", async (scenario) => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "portable.exe");
   const folder = await mkdtemp(join(tmpdir(), "attacut-update-"));
   folders.push(folder);
   vi.mocked(app.getPath).mockReturnValue(folder);
   const bytes = Buffer.from("verified executable");
   const name = `AttaCut-0.15.0-win-${process.arch}.exe`;
   await writeFile(join(folder, name), "existing download");
   vi.mocked(net.fetch).mockResolvedValueOnce(
      scenario === "http"
         ? new Response("", { status: 500 })
         : Response.json(
              scenario === "malformed"
                 ? {}
                 : { assets: [{ name, browser_download_url: "https://example.com/app", digest: "sha256:" + createHash("sha256").update(bytes).digest("hex") }] }
           )
   );
   const body =
      scenario === "interrupted"
         ? new ReadableStream({
              start(controller) {
                 controller.enqueue(bytes);
              },
              pull(controller) {
                 controller.error(new Error("lost connection"));
              },
           })
         : scenario === "checksum"
           ? Buffer.from("corrupt")
           : bytes;
   vi.mocked(net.fetch).mockResolvedValueOnce(new Response(body));
   const { manager: updates, send } = manager();
   await updates.offer(release);
   if (scenario === "success") {
      await updates.downloadPortable(release.version);
      expect(await readFile(updates.downloadedPath!)).toEqual(bytes);
      expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "downloaded", percent: 100 }));
   } else {
      await expect(updates.downloadPortable(release.version)).rejects.toThrow();
      expect(updates.downloadedPath).toBeNull();
      expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "error" }));
   }
   expect(await readFile(join(folder, name), "utf8")).toBe("existing download");
   expect((await readdir(folder)).some((file) => file.endsWith(".part"))).toBe(false);
});

it.skipIf(process.platform === "darwin").each(["missing", "rejected"])("automatic update check handles %s packages", async (scenario) => {
   vi.stubEnv("PORTABLE_EXECUTABLE_FILE", "");
   vi.stubEnv("APPIMAGE", "/test/app");
   Object.defineProperty(process, "resourcesPath", { value: tmpdir(), configurable: true });
   if (scenario === "missing") automatic.checkForUpdates.mockResolvedValue(null);
   else automatic.checkForUpdates.mockRejectedValue(new Error("connection failed"));
   const { manager: updates, send } = manager();
   await updates.offer(release);
   await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith("update:status", expect.objectContaining({ phase: "error" })));
   expect(updates.isReady).toBe(false);
   expect(() => updates.install()).toThrow("not ready");
});
