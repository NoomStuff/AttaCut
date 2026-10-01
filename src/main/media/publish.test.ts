import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as streams from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishOutput } from "./publish";

vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof fs>()), link: vi.fn() }));
vi.mock("node:stream/promises", async (original) => ({ ...(await original<typeof streams>()), pipeline: vi.fn() }));
afterEach(() => vi.resetAllMocks());

async function fixture(work: (source: string, destination: string) => Promise<void>) {
   const folder = await fs.mkdtemp(join(tmpdir(), "attacut-publication-"));
   try {
      const source = join(folder, "temporary");
      await fs.writeFile(source, "verified media");
      await work(source, join(folder, "output"));
   } finally {
      await fs.rm(folder, { recursive: true, force: true });
   }
}

it.each(["EXDEV", "EPERM", "ENOTSUP", "ENOSYS"])("copies exclusively when linking fails with %s", async (code) => {
   vi.mocked(fs.link).mockRejectedValue(Object.assign(new Error(code), { code }));
   const actual = await vi.importActual<typeof streams>("node:stream/promises");
   vi.mocked(streams.pipeline).mockImplementation(actual.pipeline);
   await fixture(async (source, destination) => {
      await publishOutput(source, destination);
      expect(await fs.readFile(destination, "utf8")).toBe("verified media");
      await expect(fs.stat(source)).rejects.toMatchObject({ code: "ENOENT" });
   });
});

it("preserves an existing destination when fallback copying races publication", async () => {
   vi.mocked(fs.link).mockRejectedValue(Object.assign(new Error("cross volume"), { code: "EXDEV" }));
   await fixture(async (source, destination) => {
      await fs.writeFile(destination, "existing original");
      await expect(publishOutput(source, destination)).rejects.toMatchObject({ code: "EEXIST" });
      expect(await fs.readFile(destination, "utf8")).toBe("existing original");
      expect(await fs.readFile(source, "utf8")).toBe("verified media");
      expect(streams.pipeline).not.toHaveBeenCalled();
   });
});

it.each(["ENOSPC", "EACCES", "EIO"])("cleans interrupted copies and retains verified work after %s", async (code) => {
   vi.mocked(fs.link).mockRejectedValue(Object.assign(new Error("cross volume"), { code: "EXDEV" }));
   const failure = Object.assign(new Error(code), { code });
   vi.mocked(streams.pipeline).mockImplementation(async (...args: unknown[]) => {
      const input = args[0] as { destroy: () => void };
      const output = args[1] as { write: (value: string, callback: (error?: Error | null) => void) => void; destroy: () => void };
      await new Promise<void>((resolve, reject) => output.write("partial", (error) => (error ? reject(error) : resolve())));
      input.destroy();
      output.destroy();
      throw failure;
   });
   await fixture(async (source, destination) => {
      await expect(publishOutput(source, destination)).rejects.toBe(failure);
      await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await fs.readFile(source, "utf8")).toBe("verified media");
   });
});

it("does not hide permission or disk errors from linking", async () => {
   const failure = Object.assign(new Error("denied"), { code: "EACCES" });
   vi.mocked(fs.link).mockRejectedValue(failure);
   await fixture(async (source, destination) => {
      await expect(publishOutput(source, destination)).rejects.toBe(failure);
      expect(streams.pipeline).not.toHaveBeenCalled();
      expect(await fs.readFile(source, "utf8")).toBe("verified media");
   });
});
