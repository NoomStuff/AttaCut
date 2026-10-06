import { afterEach, expect, it, vi } from "vitest";
import { ipcMain, net } from "electron";
import { registerIpc } from "./ipc";
vi.mock("electron", () => ({ app: { getVersion: () => "0.19.0" }, dialog: {}, ipcMain: { handle: vi.fn() }, net: { fetch: vi.fn() }, shell: {} }));
vi.mock("./identity", () => ({ isPackagedApp: () => true }));
afterEach(() => vi.clearAllMocks());

it("preserves update-check failures instead of claiming no newer release exists", async () => {
   const mainFrame = {};
   const webContents = { mainFrame };
   registerIpc({
      window: { webContents },
      storage: {},
      sourceSession: {},
      exportsService: {},
      takeInitialFile: vi.fn(),
      onFlushed: vi.fn(),
      onApplyUpdate: vi.fn(),
   } as unknown as Parameters<typeof registerIpc>[0]);
   vi.mocked(net.fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
   const handler = vi
      .mocked(ipcMain.handle)
      .mock.calls.filter(([channel]) => channel === "update:check")
      .at(-1)![1];
   expect(await handler({ sender: webContents, senderFrame: mainFrame } as unknown as Electron.IpcMainInvokeEvent)).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("503") },
   });
});

it("rejects both another sender and a subframe before consuming bootstrap state", async () => {
   const mainFrame = {};
   const webContents = { mainFrame };
   const takeInitialFile = vi.fn();
   registerIpc({
      window: { webContents },
      storage: {},
      sourceSession: {},
      exportsService: {},
      takeInitialFile,
      onFlushed: vi.fn(),
      onApplyUpdate: vi.fn(),
   } as unknown as Parameters<typeof registerIpc>[0]);
   const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === "app:bootstrap")![1];
   for (const event of [
      { sender: {}, senderFrame: mainFrame },
      { sender: webContents, senderFrame: {} },
   ]) {
      expect(await handler(event as unknown as Electron.IpcMainInvokeEvent)).toMatchObject({ ok: false, error: { code: "invalid-request", retryable: false } });
   }
   expect(takeInitialFile).not.toHaveBeenCalled();
});
