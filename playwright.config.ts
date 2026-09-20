import { defineConfig } from "@playwright/test";

export default defineConfig({
   testDir: "./tests/ui",
   // Electron windows share desktop focus; concurrent UI tests interfere with input.
   workers: 1,
   timeout: 120_000,
   expect: { timeout: 15_000 },
   reporter: "list",
   projects: [
      { name: "ui", testIgnore: "**/format-playback.spec.mjs" },
      { name: "playback", testMatch: "**/format-playback.spec.mjs", timeout: 300_000 },
   ],
});
