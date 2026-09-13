import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultPreferences, preferencesSchema, savedSessionSchema } from "../shared/types.ts";
import { Storage, storageVersion } from "./storage.ts";

const folder = async () => mkdtemp(join(tmpdir(), "attacut-storage-"));
const session = savedSessionSchema.parse({
   path: "C:\\video.mp4",
   size: 1,
   modified: 2,
   clips: [{ id: "a", start: 0, end: 10, color: 0 }],
   selectedId: "a",
   past: [{ clips: [], selectedId: null }],
});

describe("Storage", () => {
   it("keeps preferences, session and undo history across loads", async () => {
      const directory = await folder();
      try {
         const storage = new Storage(directory);
         storage.preferences = preferencesSchema.parse({ theme: "light" });
         storage.session = session;
         await storage.save();
         const reloaded = new Storage(directory);
         await reloaded.load();
         expect(reloaded.preferences.theme).toBe("light");
         expect(reloaded.session).toEqual(session);
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });
   it("resets to defaults when the file version is missing or newer", async () => {
      const directory = await folder();
      try {
         await writeFile(join(directory, "settings.json"), JSON.stringify({ version: storageVersion + 1, preferences: { theme: "light" }, session }));
         const storage = new Storage(directory);
         await storage.load();
         expect(storage.preferences).toEqual(defaultPreferences);
         expect(storage.session).toBeNull();
         await writeFile(join(directory, "settings.json"), JSON.stringify({ preferences: { theme: "light" }, session }));
         const legacy = new Storage(directory);
         await legacy.load();
         expect(legacy.preferences).toEqual(defaultPreferences);
         expect(legacy.session).toBeNull();
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });
});
