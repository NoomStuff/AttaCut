import { createReadStream } from "node:fs";
import { statOrNull } from "../files";
import { extname } from "node:path";
import { Readable } from "node:stream";
import type { SourceSession } from "../source-session.ts";

/** Video seeking needs explicit byte ranges; a plain file fetch can expose an empty seekable range. */
export async function serveMedia(path: string, request: Request): Promise<Response> {
   const info = await statOrNull(path);
   if (!info?.isFile()) return new Response(null, { status: 404 });
   const { size } = info;
   const mime: Record<string, string> = {
      ".mp4": "video/mp4",
      ".m4v": "video/mp4",
      ".mov": "video/quicktime",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".ts": "video/mp2t",
   };
   const headers = new Headers({
      "Content-Type": mime[extname(path).toLowerCase()] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
   });
   const range = request.headers.get("range");
   let start = 0;
   let end = size - 1;
   if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      if (!match[1]) start = Math.max(0, size - Number(match[2]));
      else {
         start = Number(match[1]);
         if (match[2]) end = Math.min(size - 1, Number(match[2]));
      }
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
   }
   headers.set("Content-Length", String(end - start + 1));
   if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
   if (size === 0) return new Response(null, { status: 200, headers });
   const stream = createReadStream(path, { start, end });
   const abort = () => stream.destroy();
   request.signal.addEventListener("abort", abort, { once: true });
   stream.once("close", () => request.signal.removeEventListener("abort", abort));
   if (request.signal.aborted) abort();
   return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}

/** `media://stream/<source id>?from=<seconds>&tracks=<indices>`, fetched by the renderer's MediaSource feeder. */
export async function streamResponse(session: Pick<SourceSession, "stream">, url: URL, signal: AbortSignal): Promise<Response> {
   const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
   const tracks = (url.searchParams.get("tracks") ?? "").split(",").filter(Boolean).map(Number);
   const from = Number(url.searchParams.get("from") ?? 0);
   if (tracks.some((track) => !Number.isSafeInteger(track) || track < 0)) return new Response("Invalid tracks", { status: 400, headers });
   try {
      const body = await session.stream(decodeURIComponent(url.pathname.slice(1)), tracks, from, signal);
      return new Response(body, { status: 200, headers: { ...headers, "Content-Type": "video/mp4" } });
   } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: signal.aborted ? 499 : 500, headers });
   }
}
