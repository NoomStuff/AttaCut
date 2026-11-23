import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { hasDisposableDesktop, hasPrivateDesktop, requireDisposableDesktop, requireTestDesktop } from "./test-isolation";

describe("desktop isolation", () => {
   afterEach(() => vi.unstubAllEnvs());
   it("rejects ordinary local, CI and self-hosted sessions", () => {
      expect(hasDisposableDesktop({})).toBe(false);
      expect(hasDisposableDesktop({ CI: "true" })).toBe(false);
      expect(hasDisposableDesktop({ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" })).toBe(false);
      expect(hasDisposableDesktop({ RUNNER_ENVIRONMENT: "github-hosted" })).toBe(false);
   });

   it("allows the disposable hosted runner contract", () => {
      expect(hasDisposableDesktop({ GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" })).toBe(true);
   });

   it("fails before any desktop work on a local machine", () => {
      vi.stubEnv("GITHUB_ACTIONS", "");
      vi.stubEnv("CI", "true");
      vi.stubEnv("ATTACUT_PRIVATE_DESKTOP", "");
      expect(() => requireDisposableDesktop()).toThrow("No desktop tests ran locally");
      expect(() => requireTestDesktop()).toThrow("bun run test:local");
   });
});

describe("private desktop", () => {
   const dir = mkdtempSync(join(tmpdir(), "attacut-isolation-"));
   writeFileSync(join(dir, "display"), ":42");
   const session = { ATTACUT_PRIVATE_DESKTOP: dir, DISPLAY: ":42", PULSE_SERVER: `unix:${join(dir, "pulse", "native")}` };
   afterEach(() => vi.unstubAllEnvs());
   afterAll(() => rmSync(dir, { recursive: true, force: true }));

   it("accepts the display and audio server the launcher created", () => {
      expect(hasPrivateDesktop(session, "linux")).toBe(true);
   });

   it("rejects sessions that can reach the real desktop", () => {
      expect(hasPrivateDesktop({ ...session, DISPLAY: ":0" }, "linux")).toBe(false);
      expect(hasPrivateDesktop({ ...session, WAYLAND_DISPLAY: "wayland-1" }, "linux")).toBe(false);
      expect(hasPrivateDesktop({ ...session, PULSE_SERVER: "unix:/run/user/1000/pulse/native" }, "linux")).toBe(false);
      expect(hasPrivateDesktop({ ...session, ATTACUT_PRIVATE_DESKTOP: join(dir, "missing") }, "linux")).toBe(false);
      expect(hasPrivateDesktop(session, "win32")).toBe(false);
   });

   it("does not unlock packaging or installer checks", () => {
      for (const [name, value] of Object.entries({ ...session, GITHUB_ACTIONS: "" })) vi.stubEnv(name, value);
      expect(() => requireDisposableDesktop()).toThrow();
   });
});
