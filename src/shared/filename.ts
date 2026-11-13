/** Repairs that change nothing a user would notice: control characters become spaces,
 * and whitespace at either end plus trailing dots go, the way Explorer drops them anyway.
 * Anything visible is left for {@link filenameError} to report instead of being rewritten. */
export function normalizeFilename(value: string): string {
   return Array.from(value, (character) => (character.charCodeAt(0) < 32 ? " " : character))
      .join("")
      .trim()
      .replace(/[\s.]+$/u, "");
}

/** Keep output names compatible with the filesystems supported by the app. Checks the name
 * as it will be written, after {@link normalizeFilename}, and never repairs anything visible:
 * the caller must show the error and block export. */
export function filenameError(value: string, extension = ""): string | null {
   const name = normalizeFilename(value);
   if (!name) return "Enter a file name";
   if (/[<>:"/\\|?*]/.test(name)) return 'File names cannot contain < > : " / \\ | ? *';
   if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) return "This file name is reserved by the filesystem";
   if (new TextEncoder().encode(outputFilename(name, extension)).length > 255) return "This file name is too long";
   return null;
}

/** Usable names that may still surprise the user. They never block export. */
export function filenameWarning(value: string): string | null {
   if (normalizeFilename(value).startsWith(".")) return "Names starting with a dot are hidden on macOS and Linux";
   return null;
}

/** The name written to disk: normalized, with the extension added unless it was typed. */
export function outputFilename(value: string, extension: string): string {
   const name = normalizeFilename(value);
   return extension && !name.toLowerCase().endsWith(extension.toLowerCase()) ? `${name}${extension}` : name;
}

export function sanitizeName(value: string): string {
   const clean = Array.from(value, (character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .join("")
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/[. ]+$/, "")
      .trim();
   if (!clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) return `clip-${clean || "untitled"}`;
   return clean.slice(0, 180);
}

export interface NamePatternContext {
   /** Original file name without extension. */
   source: string;
   /** One-based position of the output; a combined export is the only output. */
   index: number;
   count: number;
   start: number;
   end: number;
   /** Full length of the source video, for the {total} token. */
   total: number;
   /** When the export runs, for the {date} token. */
   date: Date;
}

/** Filename-safe clock: minutes and seconds with thousandths, hours only past one. */
export function patternTime(seconds: number): string {
   const total = Math.max(0, Math.round(seconds * 1000));
   const millisecond = total % 1000;
   const whole = (total - millisecond) / 1000;
   const hour = Math.floor(whole / 3600);
   const parts = [
      ...(hour > 0 ? [String(hour)] : []),
      String(Math.floor(whole / 60) % 60).padStart(2, "0"),
      String(whole % 60).padStart(2, "0"),
      String(millisecond).padStart(3, "0"),
   ];
   return `${parts.slice(0, -1).join("-")}.${parts.at(-1)}`;
}

export interface NameToken {
   token: string;
   label: string;
   description: string;
}
export const nameTokens: NameToken[] = [
   { token: "{source}", label: "Source name", description: "The original video's name" },
   { token: "{n}", label: "Clip number", description: "The clip's position, like 3" },
   { token: "{count}", label: "Clip amount", description: "How many clips are exporting" },
   { token: "{start}", label: "Start time", description: "Where the clip starts, like 02-35.400" },
   { token: "{end}", label: "End time", description: "Where the clip ends, like 02-40.200" },
   { token: "{duration}", label: "Clip duration", description: "How long the clip runs" },
   { token: "{total}", label: "Source duration", description: "How long the whole video runs" },
   { token: "{date}", label: "Export date", description: "The day you export, like 2026-10-03" },
];

export function hasNameToken(pattern: string): boolean {
   return /\{(?:source|n|count|start|end|duration|total|date)\}/.test(pattern);
}

/** Expands naming tokens. Unknown braces pass through so mistakes are visible. Only the
    source name is sanitized, since it comes from a file the user did not name for this app.
    Characters typed into the pattern itself stay, so the export fields report them. */
export function applyNamePattern(pattern: string, context: NamePatternContext): string {
   const resolved = pattern
      .replaceAll("{source}", sanitizeName(context.source))
      .replaceAll("{n}", String(context.index + 1))
      .replaceAll("{count}", String(context.count))
      .replaceAll("{start}", patternTime(context.start))
      .replaceAll("{end}", patternTime(context.end))
      .replaceAll("{duration}", patternTime(context.end - context.start))
      .replaceAll("{total}", patternTime(context.total))
      .replaceAll("{date}", patternDate(context.date));
   return normalizeFilename(resolved);
}
function patternDate(date: Date): string {
   const month = String(date.getMonth() + 1).padStart(2, "0");
   const day = String(date.getDate()).padStart(2, "0");
   return `${date.getFullYear()}-${month}-${day}`;
}

/** Names that appear more than once as written, compared case-insensitively the way
    Windows and macOS files are. Two clips resolving to one name would overwrite each other,
    so the export must not start until they differ. */
export function duplicateNames(names: string[]): Set<string> {
   const counts = new Map<string, number>();
   for (const name of names) {
      const key = normalizeFilename(name).toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
   }
   return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}
