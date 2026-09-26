import { app } from "electron";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));

// Use the same assets for native windows and Windows shell entries in every build.
export function windowIcon(): string | undefined {
   if (process.platform === "darwin") return undefined;
   const name = process.platform === "win32" ? "icon.ico" : "icon.png";
   const icon = app.isPackaged ? join(process.resourcesPath, "icons", name) : resolve(currentDirectory, "../../build", name);
   return existsSync(icon) ? icon : undefined;
}
export function registerWindowsIdentity(): void {
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
