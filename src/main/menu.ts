import { Menu, type BrowserWindow } from "electron";
import { IpcEvents } from "../shared/ipc.ts";
import { isPackagedApp } from "./identity.ts";
import type { RecentFile } from "../shared/recent.ts";

export function installMenu(window: BrowserWindow, recent: RecentFile[], onClearRecent: () => void): void {
   const item = (label: string, id: string) => ({ label, click: () => window.webContents.send(IpcEvents.command, id) });
   // The renderer opens these like a dropped file, so unsaved project changes still get a prompt.
   const recentMenu: Electron.MenuItemConstructorOptions[] = recent.length
      ? [
           ...recent.map((file) => ({ label: file.name, toolTip: file.path, click: () => window.webContents.send(IpcEvents.openFile, file.path) })),
           { type: "separator" as const },
           { label: "Clear recent", click: onClearRecent },
        ]
      : [{ label: "No recent files", enabled: false }];
   const template: Electron.MenuItemConstructorOptions[] = [
      {
         label: "File",
         submenu: [
            item("Open file…", "open"),
            { label: "Open recent", submenu: recentMenu },
            { type: "separator" },
            item("Export…", "export"),
            item("Export frame…", "frame"),
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
            item("Auto detect cuts…", "autoDetectCuts"),
            item("Merge at playhead", "merge"),
            { type: "separator" },
            item("Trim left", "setStart"),
            item("Trim right", "setEnd"),
            item("Add clip in gap", "add"),
            item("Delete clip", "delete"),
            item("Invert clips", "invert"),
            { type: "separator" },
            {
               label: "Copy clip times",
               submenu: [item("As YouTube chapters", "copyChapters"), item("As CSV", "copyCsv")],
            },
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
