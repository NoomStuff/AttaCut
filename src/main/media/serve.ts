import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

/** Video seeking needs explicit byte ranges; a plain file fetch can expose an empty seekable range. */
export async function serveMedia(path: string, request: Request): Promise<Response> {
   const { size } = await stat(path);
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
   const stream = createReadStream(path, { start, end });
   request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
   return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
