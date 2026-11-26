import { app } from "electron";
import { arch, cpus, freemem, homedir, release, totalmem } from "node:os";
import { join } from "node:path";
import { describeSystem } from "../shared/bug-report";
import { currentAppLog, homeRedactor, log, type SessionRecord } from "./app-log";
import { createZip } from "./zip";

export function systemDescription(): string {
   return describeSystem({
      platform: process.platform,
      release: release(),
      arch: arch(),
      ...(process.platform === "darwin" ? { macVersion: process.getSystemVersion() } : {}),
      wayland: process.platform === "linux" && (process.env["XDG_SESSION_TYPE"] === "wayland" || !!process.env["WAYLAND_DISPLAY"]),
      ...(process.env["XDG_CURRENT_DESKTOP"] ? { desktop: process.env["XDG_CURRENT_DESKTOP"] } : {}),
   });
}

/** Versions, hardware and recent runs: the context a log needs to be read. */
export function systemDetails(sessions: SessionRecord[]) {
   const recent = sessions.slice(-20);
   return {
      description: systemDescription(),
      locale: app.getLocale(),
      cpu: cpus()[0]?.model.trim() ?? "unknown",
      cores: cpus().length,
      memoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      gpu: app.getGPUFeatureStatus() as unknown as Record<string, string>,
      sessions: {
         recent: recent.map((session) => ({
            version: session.version,
            startedAt: new Date(session.startedAt).toISOString(),
            endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
            clean: session.clean,
            ...(session.crash ? { crash: session.crash } : {}),
         })),
         unclean: recent.filter((session) => !session.clean).length,
      },
   };
}

const archiveReadme = `AttaCut diagnostics

logs/app.log            What AttaCut did and what went wrong, newest at the end.
logs/app.log.previous   The same log from before it last rotated.
logs/updater*.log       What the updater did.
logs/sessions.jsonl     Recent runs, and whether each one closed cleanly.
system.json             Versions, hardware, the open video's codecs and recent timings.

No video, audio or thumbnails are included. Your user folder appears as ~.
Names of videos, projects and exports AttaCut knows about appear as <video>, <project> and
<export>, with their extension.
`;

/** A zip of every log and `report`, with the home folder removed. */
export async function logArchive(report: (sessions: SessionRecord[]) => object): Promise<Buffer> {
   const home = homeRedactor(homedir());
   const appLog = currentAppLog();
   // File names logged before this run knew them as private, like a crash from the last run.
   const redact = (text: string) => home(appLog ? appLog.paths.scrub(text) : text);
   log("diagnostics: exporting logs");
   const updaterLogs = ["updater.old.log", "updater.log"].map((name) => join(app.getPath("logs"), name));
   const logs = appLog ? await appLog.entries(redact, updaterLogs) : [];
   const sessions = appLog ? await appLog.history() : [];
   return createZip([{ name: "README.txt", data: archiveReadme }, ...logs, { name: "system.json", data: redact(JSON.stringify(report(sessions), null, 3)) }]);
}
