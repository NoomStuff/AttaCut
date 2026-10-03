import { Menu, type BrowserWindow } from "electron";
import { IpcEvents } from "../shared/ipc.ts";
import { isPackagedApp } from "./identity.ts";

export function installMenu(window: BrowserWindow): void {
   const item = (label: string, id: string) => ({ label, click: () => window.webContents.send(IpcEvents.command, id) });
   const template: Electron.MenuItemConstructorOptions[] = [
      {
         label: "File",
         submenu: [
            item("Open file…", "open"),
            { type: "separator" },
            item("Export…", "export"),
            item("Export current frame…", "frame"),
            { type: "separator" },
            item("Save project", "saveProject"),
            item("Save project as…", "saveProjectAs"),
            item("Close project", "closeProject"),
            { type: "separator" },
            item("Quit AttaCut", "quit"),
         ],
      },
      {
         label: "Edit",
         submenu: [
            item("Undo", "undo"),
            item("Redo", "redo"),
            { type: "separator" },
            item("Split at playhead", "split"),
            item("Merge at playhead", "merge"),
            { type: "separator" },
            item("Trim left", "setStart"),
            item("Trim right", "setEnd"),
            item("Add clip in gap", "add"),
            item("Delete clip", "delete"),
            { type: "separator" },
            item("Settings…", "settings"),
         ],
      },
      {
         label: "View",
         submenu: [
            item("Zoom in", "zoomIn"),
            item("Zoom out", "zoomOut"),
            item("Fit timeline", "fit"),
            item("Focus highlighted clip", "focusClip"),
            { type: "separator" },
            item("Preview clip", "preview"),
            { type: "separator" },
            item("Fullscreen video", "fullscreen"),
            { type: "separator" },
            item("Settings…", "options"),
            ...(!isPackagedApp() ? [{ type: "separator" as const }, { role: "toggleDevTools" as const }] : []),
         ],
      },
      {
         label: "Help",
         submenu: [
            item("Help", "help"),
            item("Keyboard shortcuts", "shortcuts"),
            { type: "separator" },
            item("Releases page", "releases"),
            item("About", "about"),
            { type: "separator" },
            item("Factory reset", "reset"),
         ],
      },
   ];
   if (process.platform === "darwin") template.unshift({ role: "appMenu" });
   Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
