import { afterEach, describe, expect, it, vi } from "vitest";
import { hasDisposableDesktop, requireDisposableDesktop } from "./test-isolation";

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
      expect(() => requireDisposableDesktop()).toThrow("No desktop tests ran locally");
   });
});
