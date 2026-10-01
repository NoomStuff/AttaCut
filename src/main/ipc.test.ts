import { expect, it, vi } from "vitest";
import { ipcMain } from "electron";
import { registerIpc } from "./ipc";
vi.mock("electron", () => ({ app: {}, dialog: {}, ipcMain: { handle: vi.fn() }, net: {}, shell: {} }));

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
