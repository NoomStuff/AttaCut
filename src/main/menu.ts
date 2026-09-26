import { app, Menu, type BrowserWindow } from "electron";
import { IpcEvents } from "../shared/ipc.ts";

export function installMenu(window: BrowserWindow): void {
   const item = (label: string, id: string) => ({ label, click: () => window.webContents.send(IpcEvents.command, id) });
   const template: Electron.MenuItemConstructorOptions[] = [
      {
         label: "File",
         submenu: [item("Import video…", "open"), item("Export current frame…", "frame"), item("Export…", "export"), { type: "separator" }, { role: "quit" }],
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
