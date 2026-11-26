const repositoryUrl = "https://github.com/NoomStuff/AttaCut";

/** An error the renderer caught or failed to catch, forwarded to the app log. */
export interface RendererError {
   kind: "error" | "rejection" | "react";
   message: string;
   stack?: string | undefined;
   /** React's component stack, or the script location for window errors. */
   source?: string | undefined;
}

export interface BugReportContext {
   version: string;
   system: string;
   /** The saved archive's file name, so the form can tell the user what to attach. */
   archive?: string;
}

/**
 * The new-issue page with the bug form chosen and the fields the app knows filled in.
 * Field ids match .github/ISSUE_TEMPLATE/bug-report.yml.
 */
export function bugReportUrl(context: BugReportContext): string {
   const url = new URL(`${repositoryUrl}/issues/new`);
   url.searchParams.set("template", "bug-report.yml");
   url.searchParams.set("version", `${context.version}, ${context.system}`);
   if (context.archive) url.searchParams.set("logs", `Attach ${context.archive} here (drag it into this box).`);
   return url.toString();
}

const windowsNames: Array<[number, string]> = [
   [22000, "Windows 11"],
   [10240, "Windows 10"],
];

/** "Windows 11 (10.0.26100) x64", "macOS 15.1 arm64", "Linux 6.12.1 x64 Wayland (KDE)". */
export function describeSystem(input: { platform: string; release: string; arch: string; macVersion?: string; wayland?: boolean; desktop?: string }): string {
   if (input.platform === "win32") {
      const build = Number(input.release.split(".")[2] ?? 0);
      const name = windowsNames.find(([minimum]) => build >= minimum)?.[1] ?? "Windows";
      return `${name} (${input.release}) ${input.arch}`;
   }
   if (input.platform === "darwin") return `macOS ${input.macVersion || input.release} ${input.arch}`;
   if (input.platform === "linux") {
      const session = input.wayland ? " Wayland" : " X11";
      return `Linux ${input.release} ${input.arch}${session}${input.desktop ? ` (${input.desktop})` : ""}`;
   }
   return `${input.platform} ${input.release} ${input.arch}`;
}

/** A dated, sortable archive name. */
export function logArchiveName(at: Date): string {
   const pad = (value: number) => String(value).padStart(2, "0");
   return `AttaCut-logs-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.zip`;
}
