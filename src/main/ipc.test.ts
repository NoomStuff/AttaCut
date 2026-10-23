import { afterEach, expect, it, vi } from "vitest";
import { dialog, ipcMain, net } from "electron";
import { registerIpc } from "./ipc";
import { defaultPreferences } from "../shared/defaults";
import type { SavedSession } from "../shared/types";
vi.mock("electron", () => ({
   app: { getVersion: () => "0.19.0" },
   dialog: { showMessageBox: vi.fn() },
   ipcMain: { handle: vi.fn() },
   net: { fetch: vi.fn() },
   shell: {},
}));
vi.mock("./identity", () => ({ isPackagedApp: () => true }));
afterEach(() => vi.clearAllMocks());

function persistenceFixture() {
   const clip = { id: "clip", start: 0, end: 6, color: 0 };
   const session: SavedSession = {
      path: "source.mp4",
      size: 100,
      modified: 1,
      clips: [clip],
      selectedId: clip.id,
      past: [],
      future: [],
      project: { path: "saved.attacut", savedClips: [{ ...clip, end: 8.5 }] },
   };
   const mainFrame = {};
   const webContents = { mainFrame };
   const storage = { preferences: defaultPreferences, session: null as SavedSession | null, save: vi.fn(async () => {}) };
   const onFlushed = vi.fn();
   registerIpc({
      window: { webContents },
      storage,
      sourceSession: {},
      exportsService: {},
      takeInitialFile: vi.fn(),
      onFlushed,
      onApplyUpdate: vi.fn(),
   } as unknown as Parameters<typeof registerIpc>[0]);
   const invoke = (channel: string, value: unknown) => {
      const handler = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)![1];
      return handler({ sender: webContents, senderFrame: mainFrame } as unknown as Electron.IpcMainInvokeEvent, value);
   };
   return { session, storage, onFlushed, invoke };
}

it("keeps the final discard snapshot when an autosave arrives during or after close", async () => {
   const { session, storage, onFlushed, invoke } = persistenceFixture();
   vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false });
   let finish!: () => void;
   storage.save.mockImplementationOnce(
      () =>
         new Promise((resolve) => {
            finish = resolve;
         })
   );
   const closing = invoke("state:flush", { preferences: defaultPreferences, session, closing: true });
   await vi.waitFor(() => expect(storage.save).toHaveBeenCalledOnce());
   expect(storage.session!.clips[0]!.end).toBe(8.5);
   const autosave = invoke("session:save", session);
   const preferences = invoke("preferences:save", { ...defaultPreferences, volume: 0.1 });
   expect(storage.session!.clips[0]!.end).toBe(8.5);
   expect(storage.preferences.volume).toBe(defaultPreferences.volume);
   finish();
   expect(await closing).toMatchObject({ ok: true });
   await Promise.all([autosave, preferences]);
   expect(onFlushed).toHaveBeenCalledWith(true);
   await invoke("session:save", session);
   expect(storage.session!.clips[0]!.end).toBe(8.5);
});

it("resumes autosaving when the final close is cancelled or fails", async () => {
   for (const reason of ["cancel", "failure"] as const) {
      vi.clearAllMocks();
      const { session, storage, onFlushed, invoke } = persistenceFixture();
      let finishDecision!: (value: Electron.MessageBoxReturnValue) => void;
      vi.mocked(dialog.showMessageBox).mockImplementationOnce(
         () =>
            new Promise((resolve) => {
               finishDecision = resolve;
            })
      );
      if (reason === "failure") storage.save.mockRejectedValueOnce(new Error("Disk full"));
      const closing = invoke("state:flush", { preferences: defaultPreferences, session, closing: true });
      const autosave = invoke("session:save", session);
      finishDecision({ response: reason === "cancel" ? 2 : 1, checkboxChecked: false });
      await closing;
      expect(onFlushed).toHaveBeenCalledWith(false);
      await autosave;
      expect(storage.session!.clips[0]!.end).toBe(6);
   }
});

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
