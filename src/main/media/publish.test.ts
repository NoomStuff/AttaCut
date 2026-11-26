import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as streams from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configurePublishJournal, configureTrash, copyFileTimes, publishOutput } from "./publish";

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

it("moves a replaced file to the trash before publishing over it", async () => {
   const actual = await vi.importActual<typeof fs>("node:fs/promises");
   vi.mocked(fs.link).mockImplementation(actual.link);
   await fixture(async (source, destination) => {
      await fs.writeFile(destination, "existing original");
      const trashed: string[] = [];
      configureTrash(async (path) => {
         trashed.push(await fs.readFile(path, "utf8"));
         await fs.rm(path);
      });
      try {
         await publishOutput(source, destination, true, undefined, false, { trash: true });
      } finally {
         configureTrash(null);
      }
      expect(trashed).toEqual(["existing original"]);
      expect(await fs.readFile(destination, "utf8")).toBe("verified media");
   });
});

it("records a replacement before trashing and keeps the new file nearby when it can't take the old one's place", async () => {
   const actual = await vi.importActual<typeof fs>("node:fs/promises");
   await fixture(async (source, destination) => {
      vi.mocked(fs.link).mockImplementation(async (from, to) => {
         if (to === destination) throw Object.assign(new Error("denied"), { code: "EACCES" });
         await actual.link(from, to);
      });
      await fs.writeFile(destination, "existing original");
      const steps: string[] = [];
      configurePublishJournal({
         publishing: async (_folder, temporary, target) => void steps.push(`journal ${temporary === source} ${target === destination}`),
      });
      configureTrash(async (path) => {
         steps.push("trash");
         await fs.rm(path);
      });
      try {
         await expect(publishOutput(source, destination, true, undefined, false, { trash: true })).rejects.toThrow('so it was saved as "output (2)"');
      } finally {
         configureTrash(null);
         configurePublishJournal(null);
      }
      expect(steps).toEqual(["journal true true", "trash"]);
      expect(await fs.readFile(`${destination} (2)`, "utf8")).toBe("verified media");
   });
});

it("leaves a file alone when it cannot go to the trash", async () => {
   await fixture(async (source, destination) => {
      await fs.writeFile(destination, "existing original");
      await expect(publishOutput(source, destination, true, undefined, false, { trash: true })).rejects.toThrow("left unchanged");
      configureTrash(async () => {
         throw new Error("This volume has no Recycle Bin");
      });
      try {
         await expect(publishOutput(source, destination, true, undefined, false, { trash: true })).rejects.toThrow("left unchanged");
      } finally {
         configureTrash(null);
      }
      expect(await fs.readFile(destination, "utf8")).toBe("existing original");
      expect(await fs.readFile(source, "utf8")).toBe("verified media");
   });
});

it("gives a published file the source's dates", async () => {
   await fixture(async (source) => {
      const created = Date.UTC(2023, 4, 6, 7, 8, 9);
      const modified = Date.UTC(2024, 1, 2, 3, 4, 5);
      await copyFileTimes(source, { accessed: modified, modified, created });
      const info = await fs.stat(source);
      expect(info.mtimeMs).toBe(modified);
      if (process.platform !== "linux") expect(info.birthtimeMs).toBe(created);
   });
}, 30_000);

it.each([
   ["removable", "drive without a"],
   ["size", "too big for this drive's"],
   ["off", "deletes files right away"],
] as const)("refuses to replace a file the trash would delete (%s) without touching it", async (support, message) => {
   await fixture(async (source, destination) => {
      await fs.writeFile(destination, "existing original");
      const move = vi.fn(async () => undefined);
      configureTrash({ move, support: async () => support });
      try {
         const refusal = publishOutput(source, destination, true, undefined, false, { trash: true });
         await expect(refusal).rejects.toThrow(message);
         await expect(refusal).rejects.toMatchObject({ code: "ETRASH", permanent: true });
      } finally {
         configureTrash(null);
      }
      expect(move).not.toHaveBeenCalled();
      expect(await fs.readFile(destination, "utf8")).toBe("existing original");
   });
});

it("retries a trash move that a reader briefly blocks", async () => {
   const actual = await vi.importActual<typeof fs>("node:fs/promises");
   vi.mocked(fs.link).mockImplementation(actual.link);
   await fixture(async (source, destination) => {
      await fs.writeFile(destination, "existing original");
      let attempts = 0;
      configureTrash(async (path) => {
         if (++attempts < 3) throw new Error("The process cannot access the file because it is being used by another process.");
         await fs.rm(path);
      });
      try {
         await publishOutput(source, destination, true, undefined, false, { trash: true });
      } finally {
         configureTrash(null);
      }
      expect(attempts).toBe(3);
      expect(await fs.readFile(destination, "utf8")).toBe("verified media");
   });
});
