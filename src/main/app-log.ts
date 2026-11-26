import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { ZipEntry } from "./zip";

export type LogLevel = "info" | "warn" | "error";

/**
 * One rotating log file. Lines queue in memory and reach disk in order, after `delayMs`
 * (0 writes on the next turn). A rotation keeps exactly one previous file, so the folder
 * stays bounded at roughly twice `maxBytes`.
 */
export class LogFile {
   private pending: string[] = [];
   private timer: NodeJS.Timeout | undefined;
   private writing: Promise<void> = Promise.resolve();
   private ready = false;
   readonly path: string;
   private readonly maxBytes: number;
   private readonly delayMs: number;
   constructor(path: string, maxBytes: number, delayMs = 0) {
      this.path = path;
      this.maxBytes = maxBytes;
      this.delayMs = delayMs;
   }

   get previousPath(): string {
      return `${this.path}.previous`;
   }

   write(text: string): void {
      this.pending.push(text);
      if (this.timer) return;
      this.timer = setTimeout(() => void this.flush(), this.delayMs);
      this.timer.unref?.();
   }

   flush(): Promise<void> {
      clearTimeout(this.timer);
      this.timer = undefined;
      const text = this.pending.join("");
      this.pending = [];
      if (!text) return this.writing;
      this.writing = this.writing.then(() => this.append(text)).catch(() => undefined);
      return this.writing;
   }

   /** For a process that is about to die: no promise will get to run. */
   flushSync(): void {
      clearTimeout(this.timer);
      this.timer = undefined;
      const text = this.pending.join("");
      this.pending = [];
      if (!text) return;
      try {
         mkdirSync(join(this.path, ".."), { recursive: true });
         if ((statSync(this.path, { throwIfNoEntry: false })?.size ?? 0) > this.maxBytes) {
            rmSync(this.previousPath, { force: true });
            renameSync(this.path, this.previousPath);
         }
         appendFileSync(this.path, text);
      } catch {
         /* Diagnostics must not break the app, even while it fails. */
      }
   }

   /** Drops queued lines and both files. Writes after this start a fresh file. */
   clear(): Promise<void> {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.pending = [];
      this.writing = this.writing
         .then(async () => {
            await rm(this.path, { force: true });
            await rm(this.previousPath, { force: true });
         })
         .catch(() => undefined);
      return this.writing;
   }

   private async append(text: string) {
      if (!this.ready) {
         await mkdir(join(this.path, ".."), { recursive: true });
         this.ready = true;
      }
      if (((await stat(this.path).catch(() => null))?.size ?? 0) > this.maxBytes) {
         await rm(this.previousPath, { force: true });
         await rename(this.path, this.previousPath).catch(() => undefined);
      }
      await appendFile(this.path, text);
   }
}

const sessionSchema = z.object({
   version: z.string().max(100),
   pid: z.number().int(),
   startedAt: z.number(),
   endedAt: z.number().optional(),
   clean: z.boolean(),
   // Set when the process noticed its own failure before it went down.
   crash: z.string().max(2000).optional(),
});
export type SessionRecord = z.infer<typeof sessionSchema>;

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces the names of the user's files with placeholders, so a log can be shared without
 * saying what someone was editing. FFmpeg puts full paths in its errors, and a home folder
 * swap alone still leaves the file name. Keeps the extension, which is what a bug needs.
 */
export class PathScrubber {
   private readonly names = new Map<string, string>();
   /** Bare file names, which only match where a name starts. */
   private readonly bare = new Set<string>();
   private pattern: RegExp | null = null;
   private readonly platform: NodeJS.Platform;
   private readonly home: string;
   private readonly limit = 200;
   constructor(platform: NodeJS.Platform = process.platform, home = homedir()) {
      this.platform = platform;
      this.home = home.replace(/[\\/]+$/, "").replace(/\\/g, "/");
   }

   /** `label` names the placeholder: a video at /a/b/trip.mkv becomes <video>.mkv in <video folder>. */
   add(path: string, label: string): void {
      const separator = /^[a-z]:\\|\\\\/i.test(path) || this.platform === "win32" ? "\\" : "/";
      const native = separator === "\\" ? path.replace(/\//g, "\\") : path;
      const file = basename(native.replace(/\\/g, "/"));
      const folder = dirname(native.replace(/\\/g, "/"));
      const extension = extname(file);
      const placeholders: Array<[string, string]> = [[native, `<${label}>${extension}`]];
      // A drive root, the home folder or one above it would match unrelated paths; the home
      // redactor already turns those into ~.
      const homeOrAbove = this.key(`${this.home}/`).startsWith(this.key(`${folder.replace(/\/+$/, "")}/`));
      if (folder.replace(/^[a-z]:/i, "").length > 1 && !homeOrAbove)
         placeholders.push([separator === "\\" ? folder.replace(/\//g, "\\") : folder, `<${label} folder>`]);
      // Very short names would replace ordinary words in unrelated lines.
      if (file.length >= 6) {
         placeholders.push([file, `<${label}>${extension}`]);
         this.bare.add(this.key(file));
      }
      for (const [text, placeholder] of placeholders)
         for (const variant of new Set([text, text.replace(/\\/g, "/"), text.replace(/\//g, "\\"), text.replace(/\\/g, "\\\\")])) {
            this.names.delete(this.key(variant));
            this.names.set(this.key(variant), placeholder);
         }
      while (this.names.size > this.limit * 8) {
         const oldest = this.names.keys().next().value!;
         this.names.delete(oldest);
         this.bare.delete(oldest);
      }
      this.pattern = null;
   }

   scrub(text: string): string {
      if (!this.names.size) return text;
      this.pattern ??= new RegExp(
         [...this.names.keys()]
            .sort((a, b) => b.length - a.length)
            .map((name) => (this.bare.has(name) ? `(?<![\\w.-])${escapePattern(name)}` : escapePattern(name)))
            .join("|"),
         this.platform === "win32" ? "gi" : "g"
      );
      return text.replace(this.pattern, (match) => this.names.get(this.key(match)) ?? match);
   }

   private key(text: string) {
      return this.platform === "win32" ? text.toLowerCase() : text;
   }
}

export interface AppLogOptions {
   directory: string;
   version: string;
   pid?: number;
   now?: () => number;
   /** Before the file rotates. */
   maxBytes?: number;
}

const historyLimit = 50;

/**
 * The app log and a record of how each run ended. Nothing here leaves the computer; an export
 * packs it for the user to attach themselves.
 */
export class AppLog {
   readonly directory: string;
   readonly file: LogFile;
   readonly paths = new PathScrubber();
   private readonly options: AppLogOptions;
   private session: SessionRecord | undefined;
   constructor(options: AppLogOptions) {
      this.options = options;
      this.directory = options.directory;
      this.file = new LogFile(join(options.directory, "app.log"), options.maxBytes ?? 2 * 1024 * 1024);
   }

   private get now() {
      return (this.options.now ?? Date.now)();
   }
   private get sessionPath() {
      return join(this.directory, "session.json");
   }
   private get historyPath() {
      return join(this.directory, "sessions.jsonl");
   }

   log(message: string, level: LogLevel = "info"): void {
      const text = this.paths.scrub(message).replace(/\r?\n/g, "\n    ");
      this.file.write(`${new Date(this.now).toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`);
   }

   /**
    * Marks this run as started and returns how the previous one ended. A previous run that
    * never marked itself clean crashed, was killed, or lost power.
    */
   async begin(): Promise<SessionRecord | null> {
      await mkdir(this.directory, { recursive: true });
      const previous = await readFile(this.sessionPath, "utf8")
         .then((text) => sessionSchema.safeParse(JSON.parse(text)))
         .then((result) => (result.success ? result.data : null))
         .catch(() => null);
      if (previous) await this.remember(previous).catch(() => undefined);
      this.session = { version: this.options.version, pid: this.options.pid ?? process.pid, startedAt: this.now, clean: false };
      await writeFile(this.sessionPath, JSON.stringify(this.session));
      return previous;
   }

   /** Writes synchronously: this runs while the app quits. */
   end(): void {
      if (!this.session) return;
      this.session = { ...this.session, clean: true, endedAt: this.now };
      this.file.flushSync();
      try {
         writeFileSync(this.sessionPath, JSON.stringify(this.session));
      } catch {
         /* The next run reports this one as unclean, which is the safe mistake. */
      }
   }

   /**
    * Removes the log and the record of past runs. The marker for this run stays, so the next
    * launch still knows whether this one closed cleanly.
    */
   async clear(): Promise<void> {
      await Promise.all([this.file.clear(), rm(this.historyPath, { force: true })]);
   }

   /** The process is going down with this error. Keep it with the run, and get the log on disk. */
   crashed(description: string): void {
      this.log(`crash: ${description}`, "error");
      this.file.flushSync();
      if (!this.session) return;
      this.session = { ...this.session, crash: description.slice(0, 2000) };
      try {
         writeFileSync(this.sessionPath, JSON.stringify(this.session));
      } catch {
         /* Already failing. */
      }
   }

   /** Past runs, oldest first, not counting the current one. */
   async history(): Promise<SessionRecord[]> {
      const text = await readFile(this.historyPath, "utf8").catch(() => "");
      return text.split("\n").flatMap((line) => {
         try {
            const parsed = sessionSchema.safeParse(JSON.parse(line));
            return parsed.success ? [parsed.data] : [];
         } catch {
            return [];
         }
      });
   }

   flush(): Promise<void> {
      return this.file.flush();
   }

   /** The log files and any `extra` files that exist, with `redact` applied, ready for an archive. */
   async entries(redact: (text: string) => string, extra: string[] = []): Promise<ZipEntry[]> {
      await this.flush();
      const files = [this.file.previousPath, this.file.path, this.historyPath, ...extra];
      const entries = await Promise.all(
         files.map(async (path): Promise<ZipEntry[]> => {
            const text = await readFile(path, "utf8").catch(() => null);
            return text === null ? [] : [{ name: `logs/${basename(path)}`, data: redact(text) }];
         })
      );
      return entries.flat();
   }

   private async remember(previous: SessionRecord) {
      const history = [...(await this.history()), previous].slice(-historyLimit);
      await writeFile(this.historyPath, history.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
   }
}

/**
 * Replaces the user's home folder with `~`, so an export doesn't carry their account name.
 * Windows paths compare without case, and either slash direction.
 */
export function homeRedactor(home: string, platform: NodeJS.Platform = process.platform): (text: string) => string {
   const trimmed = home.replace(/[\\/]+$/, "");
   if (trimmed.length < 3) return (text) => text;
   const variants = new Set([trimmed, trimmed.replace(/\\/g, "/"), trimmed.replace(/\//g, "\\"), trimmed.replace(/\\/g, "\\\\")]);
   const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
   const pattern = new RegExp([...variants].map(escape).join("|"), platform === "win32" ? "gi" : "g");
   return (text) => text.replace(pattern, "~");
}

/** Reads the current session marker synchronously, for tests and crash handlers. */
export function readSession(directory: string): SessionRecord | null {
   try {
      const parsed = sessionSchema.safeParse(JSON.parse(readFileSync(join(directory, "session.json"), "utf8")));
      return parsed.success ? parsed.data : null;
   } catch {
      return null;
   }
}

let current: AppLog | null = null;

/** The process-wide log. Lines written before this are dropped. */
export function startAppLog(options: AppLogOptions): AppLog {
   current = new AppLog(options);
   return current;
}

/** A file of the user's that log lines must not name. See PathScrubber. */
export function keepPrivate(path: string, label: string): void {
   current?.paths.add(path, label);
}

/** Logging never throws into the caller: a full disk must not break an export. */
export function log(message: string, level: LogLevel = "info"): void {
   try {
      current?.log(message, level);
   } catch {
      /* Diagnostics must not break the app. */
   }
}

export function errorText(error: unknown): string {
   return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

export function currentAppLog(): AppLog | null {
   return current;
}
