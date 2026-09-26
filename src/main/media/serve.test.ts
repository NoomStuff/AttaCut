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
