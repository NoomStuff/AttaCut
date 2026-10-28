import { chmod, copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { comparePayload, payloadFiles } from "./verify-unix-payloads";

it("rejects changes to runtime bytes, package additions, and the full file list", async () => {
   const root = await mkdtemp(join(tmpdir(), "attacut-payload-"));
   try {
      await mkdir(join(root, "resources"));
      await writeFile(join(root, "app"), "runtime");
      await writeFile(join(root, "resources", "media"), "media");
      const expected = await payloadFiles(root);
      expect(() => comparePayload(expected, { ...expected })).not.toThrow();
      expect(() => comparePayload(expected, { ...expected, app: "changed" })).toThrow("app");
      expect(() => comparePayload(expected, { app: expected["app"]! })).toThrow("file list");
      expect(() => comparePayload(expected, { ...expected, added: "extra" })).toThrow("file list");
      await copyFile(join(root, "app"), join(root, "AppRun"));
      const final = await payloadFiles(root);
      // Runtime comparison accepts package wrappers. The retained final-package
      // inventory also binds every wrapper and injected library by exact path/hash.
      expect(() => comparePayload(expected, final, false)).not.toThrow();
      expect(() => comparePayload(final, { ...final, AppRun: "changed" })).toThrow("AppRun");
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});

it.skipIf(process.platform === "win32")("compares symlink targets and executable permissions", async () => {
   const root = await mkdtemp(join(tmpdir(), "attacut-payload-links-"));
   try {
      await writeFile(join(root, "app"), "runtime");
      await chmod(join(root, "app"), 0o755);
      await symlink("app", join(root, "AppRun"));
      const expected = await payloadFiles(root);
      await chmod(join(root, "app"), 0o644);
      expect(() => comparePayload(expected, { ...expected, AppRun: "link:other-app" })).toThrow("AppRun");
      const actual = await payloadFiles(root);
      expect(() => comparePayload(expected, actual)).toThrow("app");
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});
