// Native splash handover, shared line for line by AcroClip, AttaCut and Deduup apart from
// the app block. The Windows product executable is the launcher from scripts/splash: it
// shows the splash at once and starts this Electron runtime, renamed <Product>-app.exe.
import type { BrowserWindow } from "electron";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

// App block: the only lines that differ between the apps.
const product = "AttaCut";
const signalVariable = "ATTACUT_SPLASH_SIGNAL";
const accent = "#9bc9f0";
// End of the app block.

/**
 * Closing should feel instant. While work still finishes after the user chose to close,
 * the window's content fades to its background colour with a spinner. Returns a function
 * that brings the content back, for a close that was called off.
 */
export async function fadeForExit(window: BrowserWindow): Promise<() => void> {
   if (window.isDestroyed() || !window.isVisible()) return () => undefined;
   const css = `
      html { background: ${window.getBackgroundColor()} !important; }
      body > * { opacity: 0 !important; transition: opacity 160ms ease-out !important; pointer-events: none !important; }
      html::after {
         content: ""; position: fixed; z-index: 2147483647; top: 50%; left: 50%; width: 22px; height: 22px; margin: -14px 0 0 -14px;
         border: 3px solid rgba(255, 255, 255, 0.11); border-top-color: ${accent}; border-radius: 50%; animation: app-exiting-spin 0.8s linear infinite;
      }
      @keyframes app-exiting-spin { to { transform: rotate(360deg); } }`;
   const key = await window.webContents.insertCSS(css).catch(() => null);
   return () => {
      if (key && !window.isDestroyed()) void window.webContents.removeInsertedCSS(key).catch(() => undefined);
   };
}

/** The launcher beside this runtime, so relaunches and login starts show the splash too. */
export function launcherPath(): string {
   const launcher = join(dirname(process.execPath), `${product}.exe`);
   return process.platform === "win32" && basename(process.execPath) === `${product}-app.exe` && existsSync(launcher) ? launcher : process.execPath;
}

/** Tells the launcher's splash that the app's own window can take over. */
export function releaseSplash(): void {
   const signal = process.env[signalVariable];
   if (!signal) return;
   Reflect.deleteProperty(process.env, signalVariable);
   void writeFile(signal, "1").catch(() => undefined);
}

/**
 * Shows the splash while a Windows update installs, so the app never seems to vanish.
 * It runs from a temporary copy, because the installer replaces every file in the app
 * folder, and closes when the updated app's launcher starts at the same spot.
 */
export function showUpdateSplash(): void {
   if (process.platform !== "win32") return;
   const splash = join(process.resourcesPath, "splash.exe");
   const icon = join(process.resourcesPath, "icons", "icon.png");
   if (!existsSync(splash)) return;
   try {
      const folder = join(tmpdir(), `${product.toLowerCase()}-update-splash`);
      mkdirSync(folder, { recursive: true });
      copyFileSync(splash, join(folder, `${product}.exe`));
      if (existsSync(icon)) copyFileSync(icon, join(folder, "icon.png"));
      spawn(join(folder, `${product}.exe`), ["--update", join(folder, "icon.png")], { detached: true, stdio: "ignore", windowsHide: false }).unref();
   } catch {
      // Without the splash the update still installs.
   }
}
