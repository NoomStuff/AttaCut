import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveMedia } from "./serve.ts";
describe("local video byte ranges", () => {
   it("serves explicit and suffix ranges and refuses ranges outside the file", async () => {
      const folder = await mkdtemp(join(tmpdir(), "attacut-range-"));
      const path = join(folder, "video.mp4");
      await writeFile(path, "0123456789");
      try {
         const response = await serveMedia(path, new Request("https://local/video", { headers: { Range: "bytes=3-6" } }));
         expect(response.status).toBe(206);
         expect(response.headers.get("Content-Range")).toBe("bytes 3-6/10");
         expect(await response.text()).toBe("3456");
         expect(await (await serveMedia(path, new Request("https://local/video", { headers: { Range: "bytes=-3" } }))).text()).toBe("789");
         expect((await serveMedia(path, new Request("https://local/video", { headers: { Range: "bytes=20-" } }))).status).toBe(416);
      } finally {
         await rm(folder, { recursive: true, force: true });
      }
   });
});

it("serves full, open-ended, clamped and HEAD requests, rejecting malformed ranges", async () => {
   const folder = await mkdtemp(join(tmpdir(), "attacut-serve-"));
   const path = join(folder, "video.mp4");
   await writeFile(path, "0123456789");
   try {
      for (const [range, status, body] of [
         [null, 200, "0123456789"],
         ["bytes=4-", 206, "456789"],
         ["bytes=8-100", 206, "89"],
         ["bytes=-100", 206, "0123456789"],
      ] as const) {
         const headers = range ? { Range: range } : {};
         const response = await serveMedia(path, new Request("https://local/video", { headers }));
         expect(response.status).toBe(status);
         expect(response.headers.get("Content-Length")).toBe(String(body.length));
         expect(response.headers.get("Content-Type")).toBe("video/mp4");
         expect(await response.text()).toBe(body);
         const head = await serveMedia(path, new Request("https://local/video", { method: "HEAD", headers }));
         expect(head.status).toBe(status);
         expect(head.headers.get("Content-Length")).toBe(String(body.length));
         expect(await head.text()).toBe("");
      }
      for (const range of ["bytes=-", "bytes=-0", "bytes=9-2", "bytes=0-1,3-4", "items=0-1", "bytes=nope"]) {
         const response = await serveMedia(path, new Request("https://local/video", { headers: { Range: range } }));
         expect(response.status, range).toBe(416);
         expect(response.headers.get("Content-Range")).toBe("bytes */10");
      }
      await writeFile(path, "");
      expect(await (await serveMedia(path, new Request("https://local/video"))).text()).toBe("");
      expect((await serveMedia(path, new Request("https://local/video", { headers: { Range: "bytes=0-" } }))).status).toBe(416);
      expect((await serveMedia(join(folder, "missing"), new Request("https://local/video"))).status).toBe(404);
      await writeFile(path, Buffer.alloc(1024 * 1024));
      const controller = new AbortController();
      const response = await serveMedia(path, new Request("https://local/video", { signal: controller.signal }));
      const reading = response.arrayBuffer();
      controller.abort();
      await expect(reading).rejects.toThrow();
   } finally {
      await rm(folder, { recursive: true, force: true });
   }
});
