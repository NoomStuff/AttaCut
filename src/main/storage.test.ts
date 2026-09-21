import { mkdir, mkdtemp, rmdir, rm, writeFile } from "node:fs/promises";
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
   it("keeps the previous file after a failed write and allows retry", async () => {
      const directory = await folder();
      try {
         const storage = new Storage(directory);
         storage.session = session;
         await storage.save();
         const temporary = join(directory, "settings.json.tmp");
         await mkdir(temporary);
         storage.preferences = preferencesSchema.parse({ theme: "light" });
         await expect(storage.save()).rejects.toThrow();
         const preserved = new Storage(directory);
         await preserved.load();
         expect(preserved.preferences.theme).toBe(defaultPreferences.theme);
         expect(preserved.session).toEqual(session);
         await rmdir(temporary);
         await storage.save();
         await storage.flush();
         const recovered = new Storage(directory);
         await recovered.load();
         expect(recovered.preferences.theme).toBe("light");
         expect(recovered.session).toEqual(session);
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });
   it("flushes the newest snapshot after a burst of edits", async () => {
      const directory = await folder();
      try {
         const storage = new Storage(directory);
         const writes: Promise<void>[] = [];
         for (let index = 0; index < 100; index++) {
            storage.preferences = preferencesSchema.parse({ volume: index / 100 });
            writes.push(storage.save());
         }
         await storage.flush();
         await Promise.all(writes);
         const restored = new Storage(directory);
         await restored.load();
         expect(restored.preferences.volume).toBe(0.99);
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });
   it("recovers a valid session independently of broken preferences", async () => {
      const directory = await folder();
      try {
         await writeFile(join(directory, "settings.json"), JSON.stringify({ version: storageVersion, preferences: { volume: "bad" }, session }));
         const storage = new Storage(directory);
         await storage.load();
         expect(storage.session).toEqual(session);
         expect(storage.preferences).toEqual(defaultPreferences);
         expect(storage.warning).not.toBeNull();
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });
   it("recovers the last good backup after the primary file becomes unreadable", async () => {
      const directory = await folder();
      try {
         const storage = new Storage(directory);
         storage.session = session;
         await storage.save();
         storage.preferences = preferencesSchema.parse({ theme: "light" });
         await storage.save();
         await writeFile(join(directory, "settings.json"), "broken");
         const restored = new Storage(directory);
         await restored.load();
         expect(restored.session).toEqual(session);
         expect(restored.warning).not.toBeNull();
      } finally {
         await rm(directory, { recursive: true, force: true });
      }
   });
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
   it("keeps the update check time and ignored version across loads", async () => {
      const directory = await folder();
      try {
         const storage = new Storage(directory);
         storage.updates = { lastCheckedAt: 1234, ignoredVersion: "0.8.0" };
         await storage.save();
         const reloaded = new Storage(directory);
         await reloaded.load();
         expect(reloaded.updates).toEqual(storage.updates);
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
