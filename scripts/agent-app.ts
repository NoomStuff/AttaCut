// A long-lived dev instance of AttaCut for agents to look at and drive.
// The app runs on a private display and audio server on Linux, or as an invisible,
// muted window elsewhere, with a throwaway profile. Renderer edits hot-reload through
// Vite. Main and preload edits need `restart`.
import { _electron, type ElectronApplication, type Page } from "@playwright/test";
import type * as Electron from "electron";
import { execFileSync, spawn } from "node:child_process";
import { createServer as createHttpServer, request as httpRequest, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const sessionDir = join(root, "work", "agent-app");
const logPath = join(sessionDir, "daemon.log");
// Unix socket paths are limited to 108 bytes, so the socket lives in the temp dir, one per checkout.
const socketPath = join(tmpdir(), `attacut-agent-${createHash("sha1").update(root).digest("hex").slice(0, 10)}.sock`);
const privateDisplay = process.platform === "linux";
const idleLimitMs = 30 * 60_000;

const usage = `Usage: bun run app <command> [args]

A dev AttaCut session for agents. It never opens on your desktop or plays sound.
Renderer edits hot-reload. Run restart after editing src/main or src/preload.
The session stops itself after 30 minutes without a command.

  start [video] [--keep-profile]   build, then launch on a private display
  stop                             close the app and the dev server
  restart [video]                  rebuild main and preload, relaunch with the same profile
  status                           window, source, playback and error summary
  open <video|project>             open a file in the running app
  reload                           reload the renderer

  shot [path] [--of <selector>]    save a PNG and print its path
  tree [selector]                  accessibility tree of the page or one element
  click <selector>                 also: dblclick, hover, focus
  fill <selector> <text>           replace a field's value
  press <key> [key...]             e.g. press Space, press Control+z ArrowRight
  wait <selector> [visible|hidden|attached|detached]
  resize <width> <height>          resize the window's content area

  eval <code>                      run in the renderer, prints the JSON result
  main <code>                      run in the main process with \`electron\` in scope
  logs [--all]                     main, renderer and Vite output since the last call

Selectors are Playwright selectors: 'role=button[name="Export"]', 'text=Open file',
'.timeline-viewport'. Code with a return statement runs as a function body.`;

interface Request {
   command: string;
   args: string[];
}
interface Reply {
   ok: boolean;
   output: string;
}

function send(request: Request): Promise<Reply> {
   return new Promise((resolveReply, reject) => {
      const outgoing = httpRequest({ socketPath, path: "/command", method: "POST" }, (response) => {
         let body = "";
         response.setEncoding("utf8");
         response.on("data", (chunk: string) => (body += chunk));
         response.on("end", () => {
            try {
               resolveReply(JSON.parse(body) as Reply);
            } catch (error) {
               reject(error instanceof Error ? error : new Error(String(error)));
            }
         });
      });
      outgoing.on("error", reject);
      outgoing.end(JSON.stringify(request));
   });
}

async function isRunning(): Promise<boolean> {
   if (!existsSync(socketPath)) return false;
   try {
      return (await send({ command: "ping", args: [] })).ok;
   } catch {
      return false;
   }
}

function build(): void {
   for (const args of [["scripts/build-icons.ts"], ["x", "--no-install", "electron-vite", "build", "--logLevel", "warn"]]) {
      try {
         execFileSync(process.execPath, args, { cwd: root, stdio: "pipe", encoding: "utf8" });
      } catch (error) {
         const output = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
         throw new Error(`Build failed: bun ${args.join(" ")}\n${output}`, { cause: error });
      }
   }
}

function absoluteFile(path: string | undefined): string | undefined {
   if (!path) return undefined;
   const absolute = resolve(process.cwd(), path);
   if (!existsSync(absolute)) throw new Error(`No file at ${absolute}.`);
   return absolute;
}

async function startDaemon(args: string[]): Promise<void> {
   if (await isRunning()) {
      console.log("Already running.");
      console.log((await send({ command: "status", args: [] })).output);
      return;
   }
   rmSync(socketPath, { force: true });
   const keepProfile = args.includes("--keep-profile");
   const file = absoluteFile(args.find((arg) => !arg.startsWith("--")));
   mkdirSync(sessionDir, { recursive: true });
   if (!keepProfile) rmSync(join(sessionDir, "profile"), { recursive: true, force: true });
   build();
   const serve = [process.execPath, join(root, "scripts", "agent-app.ts"), "serve", ...(file ? [file] : [])];
   const command = privateDisplay ? [process.execPath, join(root, "scripts", "private-desktop.ts"), ...serve] : serve;
   const log = openSync(logPath, "w");
   const [executable, ...rest] = command;
   if (!executable) throw new Error("No executable.");
   const daemon = spawn(executable, rest, { cwd: root, detached: true, stdio: ["ignore", log, log] });
   closeSync(log);
   let exited = false;
   daemon.on("exit", () => (exited = true));
   daemon.unref();
   const deadline = Date.now() + 120_000;
   while (Date.now() < deadline && !exited) {
      if (await isRunning()) {
         console.log((await send({ command: "status", args: [] })).output);
         return;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
   }
   const tail = existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").slice(-30).join("\n") : "";
   throw new Error(`The dev app did not start. Last lines of ${logPath}:\n${tail}`);
}

// ---- Daemon -----------------------------------------------------------------

interface Session {
   app: ElectronApplication | null;
   page: Page | null;
   server: ViteDevServer;
   url: string;
   profile: string;
   logs: string[];
   read: number;
   shots: number;
}

const maxLogs = 2000;
function record(session: Session, line: string): void {
   const stamp = new Date().toISOString().slice(11, 23);
   for (const part of line.replace(/\s+$/, "").split("\n")) session.logs.push(`${stamp} ${part}`);
   const excess = session.logs.length - maxLogs;
   if (excess > 0) {
      session.logs.splice(0, excess);
      session.read = Math.max(0, session.read - excess);
   }
}

async function startRenderer(): Promise<{ server: ViteDevServer; url: string }> {
   const { resolveConfig } = await import("electron-vite");
   const { createServer } = await import("vite");
   const resolved = await resolveConfig({ root }, "serve", "development");
   const renderer = resolved.config?.renderer;
   if (!renderer) throw new Error("electron.vite.config.ts has no renderer config.");
   const server = await createServer({
      ...renderer,
      // A separate dependency cache keeps your own bun run dev from re-optimizing after an agent session.
      cacheDir: join(root, "node_modules", ".vite-agent-app"),
      clearScreen: false,
      logLevel: "warn",
      server: { ...renderer.server, host: "127.0.0.1", strictPort: false },
   });
   await server.listen();
   const address = server.httpServer?.address();
   if (!address || typeof address === "string") throw new Error("The renderer dev server has no TCP address.");
   return { server, url: `http://127.0.0.1:${address.port}` };
}

async function launch(session: Session, file: string | undefined): Promise<void> {
   const env: Record<string, string> = {};
   for (const [name, value] of Object.entries(process.env)) if (value !== undefined) env[name] = value;
   delete env["ELECTRON_RUN_AS_NODE"];
   Object.assign(env, {
      ELECTRON_RENDERER_URL: session.url,
      ATTACUT_USER_DATA: session.profile,
      ...(file ? { ATTACUT_OPEN_FILE: file } : {}),
      // Without a private display the window exists but stays invisible and out of the way.
      ...(privateDisplay ? {} : { ATTACUT_HIDDEN: "1" }),
   });
   const app = await _electron.launch({ args: ["."], cwd: root, env });
   session.app = app;
   app.process().stdout?.on("data", (data: Buffer) => record(session, `[main] ${String(data)}`));
   app.process().stderr?.on("data", (data: Buffer) => record(session, `[main] ${String(data)}`));
   app.on("close", () => {
      if (session.app === app) {
         session.app = null;
         session.page = null;
         record(session, "[agent] The app exited. Run restart to launch it again.");
      }
   });
   const page = await app.firstWindow();
   session.page = page;
   page.on("console", (message) => record(session, `[renderer ${message.type()}] ${message.text()}`));
   page.on("pageerror", (error) => record(session, `[pageerror] ${error.stack ?? error.message}`));
   page.on("crash", () => record(session, "[agent] The renderer crashed."));
   await page.emulateMedia({ reducedMotion: "no-preference" });
   await app.evaluate(({ BrowserWindow }, hidden) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) return;
      if (hidden) {
         if (process.platform === "win32" || process.platform === "darwin") window.setOpacity(0);
         window.setIgnoreMouseEvents(true);
         window.setSkipTaskbar(true);
         window.showInactive();
      }
      window.webContents.setAudioMuted(hidden);
   }, !privateDisplay);
   await page.locator(".app-shell").waitFor({ state: "attached", timeout: 60_000 });
}

async function close(session: Session): Promise<void> {
   const app = session.app;
   session.app = null;
   session.page = null;
   if (!app) return;
   // Playwright drops the process handle once the app closes, so take it first.
   const child = app.process();
   // An unsaved project prompts on close. A dev session should never wait on that.
   await Promise.race([app.close().catch(() => undefined), new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
   if (child.exitCode === null) child.kill();
}

function needPage(session: Session): Page {
   if (!session.page || session.page.isClosed()) throw new Error("The app is not running. Run restart.");
   return session.page;
}

function needApp(session: Session): ElectronApplication {
   if (!session.app) throw new Error("The app is not running. Run restart.");
   return session.app;
}

function functionSource(code: string, parameter: string): string {
   const body = /(^|[\s;{}])return[\s;(]/.test(code) ? code : `return (${code});`;
   return `async (${parameter}) => {\n${body}\n}`;
}

function format(value: unknown): string {
   if (value === undefined) return "undefined";
   if (typeof value === "string") return value;
   return JSON.stringify(value, null, 2);
}

async function status(session: Session): Promise<string> {
   if (!session.app || !session.page) return `Stopped. Dev server ${session.url}. Run restart.`;
   const page = session.page;
   const window = await session.app.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0];
      return current ? { bounds: current.getContentBounds(), focused: current.isFocused(), fullscreen: current.isFullScreen() } : null;
   });
   const view = await page.evaluate(() => {
      const video = document.querySelector("video");
      const active = document.activeElement;
      return {
         title: document.title,
         file: document.querySelector(".title-filename")?.textContent ?? null,
         video: video
            ? {
                 currentTime: Number(video.currentTime.toFixed(3)),
                 duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null,
                 paused: video.paused,
                 readyState: video.readyState,
                 error: video.error?.message ?? null,
              }
            : null,
         dialogs: [...document.querySelectorAll('[role="dialog"]')].map(
            (element) => element.getAttribute("aria-label") ?? element.textContent?.slice(0, 60) ?? ""
         ),
         focus:
            active && active !== document.body
               ? `${active.tagName.toLowerCase()}${active.getAttribute("aria-label") ? ` "${active.getAttribute("aria-label")}"` : ""}`
               : null,
      };
   });
   const errors = session.logs.filter((line) => line.includes("[pageerror]") || line.includes("[renderer error]")).length;
   return format({
      running: true,
      display: privateDisplay ? `private ${process.env["DISPLAY"] ?? ""}` : "hidden window",
      renderer: session.url,
      profile: session.profile,
      window,
      ...view,
      rendererErrors: errors,
      unreadLogLines: session.logs.length - session.read,
   });
}

async function handle(session: Session, { command, args }: Request): Promise<string> {
   const [first, second] = args;
   switch (command) {
      case "ping":
         return "pong";
      case "status":
         return status(session);
      case "restart": {
         await close(session);
         build();
         await launch(session, absoluteFile(first));
         return status(session);
      }
      case "open": {
         const file = absoluteFile(first);
         if (!file) throw new Error("Usage: open <file>");
         await needApp(session).evaluate(({ app }, path) => app.emit("open-file", { preventDefault: () => undefined }, path), file);
         return `Opened ${file}`;
      }
      case "reload":
         await needPage(session).reload();
         await needPage(session).locator(".app-shell").waitFor({ state: "attached" });
         return "Reloaded.";
      case "shot": {
         const of = args.indexOf("--of");
         const selector = of >= 0 ? args[of + 1] : undefined;
         const rest = args.filter((_, index) => index !== of && index !== of + 1);
         session.shots += 1;
         const path = resolve(rest[0] ?? join(sessionDir, "shots", `${String(session.shots).padStart(3, "0")}.png`));
         const page = needPage(session);
         if (selector) await page.locator(selector).first().screenshot({ path });
         else await page.screenshot({ path });
         return path;
      }
      case "tree":
         return needPage(session)
            .locator(first ?? "body")
            .first()
            .ariaSnapshot();
      case "click":
      case "dblclick":
      case "hover":
      case "focus": {
         if (!first) throw new Error(`Usage: ${command} <selector>`);
         const target = needPage(session).locator(first).first();
         await target[command]({ timeout: 5000 });
         return `${command} ${first}`;
      }
      case "fill":
         if (!first || second === undefined) throw new Error("Usage: fill <selector> <text>");
         await needPage(session).locator(first).first().fill(second, { timeout: 5000 });
         return `Filled ${first}`;
      case "press":
         if (!args.length) throw new Error("Usage: press <key> [key...]");
         for (const key of args) await needPage(session).keyboard.press(key);
         return `Pressed ${args.join(" ")}`;
      case "wait": {
         if (!first) throw new Error("Usage: wait <selector> [state]");
         const state = second === "hidden" || second === "attached" || second === "detached" ? second : "visible";
         await needPage(session).locator(first).first().waitFor({ state, timeout: 30_000 });
         return `${first} is ${state}`;
      }
      case "resize": {
         const width = Number(first);
         const height = Number(second);
         if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Error("Usage: resize <width> <height>");
         await needApp(session).evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height), {
            width,
            height,
         });
         return `Resized to ${width}x${height}`;
      }
      case "eval": {
         if (!first) throw new Error("Usage: eval <code>");
         const result: unknown = await needPage(session).evaluate(`(${functionSource(args.join(" "), "")})()`);
         return format(result);
      }
      case "main": {
         if (!first) throw new Error("Usage: main <code>");
         // Playwright serializes the function by its source and passes the electron module first.
         const run = new Function(`return ${functionSource(args.join(" "), "electron")}`)() as (electron: typeof Electron) => Promise<unknown>;
         return format(await needApp(session).evaluate(run));
      }
      case "logs": {
         const lines = args.includes("--all") ? session.logs : session.logs.slice(session.read);
         session.read = session.logs.length;
         return lines.length ? lines.join("\n") : "No new log lines.";
      }
      default:
         throw new Error(`Unknown command ${command}.\n\n${usage}`);
   }
}

async function serve(file: string | undefined): Promise<void> {
   const { server, url } = await startRenderer();
   const session: Session = { app: null, page: null, server, url, profile: join(sessionDir, "profile"), logs: [], read: 0, shots: 0 };
   mkdirSync(session.profile, { recursive: true });
   const logger = server.config.logger;
   const forward =
      (level: string) =>
      (message: string): void =>
         record(session, `[vite ${level}] ${message}`);
   logger.warn = forward("warn");
   logger.error = forward("error");
   await launch(session, file);

   let queue: Promise<unknown> = Promise.resolve();
   let lastCommand = Date.now();
   const reply = (response: ServerResponse, body: Reply): void => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
   };
   const listener = createHttpServer((incoming, response) => {
      let raw = "";
      incoming.setEncoding("utf8");
      incoming.on("data", (chunk: string) => (raw += chunk));
      incoming.on("end", () => {
         const body = JSON.parse(raw) as Request;
         if (body.command === "stop") {
            reply(response, { ok: true, output: "Stopped." });
            setTimeout(() => void shutdown(), 50);
            return;
         }
         lastCommand = Date.now();
         // One command at a time, so a click never races a screenshot.
         const run = queue.then(() => handle(session, body));
         queue = run.catch(() => undefined);
         run.then(
            (output) => reply(response, { ok: true, output }),
            (error: unknown) => reply(response, { ok: false, output: error instanceof Error ? error.message : String(error) })
         );
      });
   });
   rmSync(socketPath, { force: true });
   await new Promise<void>((resolveListen) => listener.listen(socketPath, resolveListen));
   const shutdown = async (): Promise<void> => {
      await close(session);
      await server.close();
      listener.close();
      rmSync(socketPath, { force: true });
      process.exit(0);
   };
   // A forgotten session must not keep Electron and Vite running in the background.
   setInterval(() => {
      if (Date.now() - lastCommand > idleLimitMs) void shutdown();
   }, 60_000).unref();
   process.on("SIGTERM", () => void shutdown());
   process.on("SIGINT", () => void shutdown());
   console.log(`Agent app ready on ${socketPath}`);
}

// ---- CLI --------------------------------------------------------------------

const [command = "help", ...args] = process.argv.slice(2);
if (command === "help" || command === "--help" || command === "-h") console.log(usage);
else if (command === "serve") await serve(args[0]);
else if (command === "start") await startDaemon(args);
else {
   if (!(await isRunning())) {
      if (command === "stop") console.log("Not running.");
      else {
         console.error("The dev app is not running. Start it with bun run app start [video].");
         process.exit(1);
      }
   } else {
      const reply = await send({ command, args });
      (reply.ok ? console.log : console.error)(reply.output);
      if (!reply.ok) process.exit(1);
   }
}
