import { readFileSync } from "node:fs";
import { join } from "node:path";

// CI=true alone is also used by local release verification. It is not isolation.
export function hasDisposableDesktop(env: NodeJS.ProcessEnv = process.env): boolean {
   return env["GITHUB_ACTIONS"] === "true" && env["RUNNER_ENVIRONMENT"] === "github-hosted";
}

// scripts/private-desktop.ts gives Playwright its own X display, audio server and D-Bus session.
// It isolates app windows, input and sound. It does not isolate installers or system state.
export function hasPrivateDesktop(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
   const dir = env["ATTACUT_PRIVATE_DESKTOP"];
   if (platform !== "linux" || !dir || env["WAYLAND_DISPLAY"] || !env["DISPLAY"]) return false;
   if (env["PULSE_SERVER"] !== `unix:${join(dir, "pulse", "native")}`) return false;
   try {
      return readFileSync(join(dir, "display"), "utf8") === env["DISPLAY"];
   } catch {
      return false;
   }
}

export function requireDisposableDesktop(): void {
   if (!hasDisposableDesktop()) {
      throw new Error(
         "Desktop tests require a disposable GitHub-hosted runner. Use bun run test:ui, test:playback, test:native or verify:release. No desktop tests ran locally."
      );
   }
}

// Playwright app tests also run on a private local display. Packaging and installer checks stay remote.
export function requireTestDesktop(): void {
   if (!hasDisposableDesktop() && !hasPrivateDesktop()) {
      throw new Error(
         "Desktop tests need an isolated display. On Linux, run bun run test:local. Elsewhere, use bun run test:ui, test:playback or test:native. No desktop tests ran locally."
      );
   }
}

export default requireTestDesktop;
