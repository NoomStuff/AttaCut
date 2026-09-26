import { defineConfig } from "@playwright/test";

export default defineConfig({
   testDir: "./tests/ui",
   // Electron windows share desktop focus; concurrent UI tests interfere with input.
   workers: 1,
   // A single fresh Electron process absorbs occasional cold-runner timing failures.
   // Repeatable failures still block checks and releases.
   retries: process.env["CI"] ? 1 : 0,
   timeout: 120_000,
   expect: { timeout: 15_000 },
   reporter: "list",
   use: { trace: "retain-on-failure" },
   projects: [
      { name: "ui", testIgnore: "**/format-playback.spec.mjs" },
      { name: "playback", testMatch: "**/format-playback.spec.mjs", timeout: 300_000 },
   ],
});
