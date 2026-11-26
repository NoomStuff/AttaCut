import { describe, expect, it } from "vitest";
import { createErrorReporter } from "./error-reporting";
import type { RendererError } from "../../../shared/bug-report";

describe("createErrorReporter", () => {
   it("skips repeats of the same error for a while", () => {
      const sent: RendererError[] = [];
      let now = 0;
      const report = createErrorReporter(
         async (error) => void sent.push(error),
         () => now
      );
      report("error", new Error("boom"), "Viewer.tsx:10");
      report("error", new Error("boom"));
      now = 11_000;
      report("error", new Error("boom"));
      report("rejection", "plain string");
      expect(sent.map((error) => [error.kind, error.message])).toEqual([
         ["error", "boom"],
         ["error", "boom"],
         ["rejection", "plain string"],
      ]);
      expect(sent[0]).toMatchObject({ source: "Viewer.tsx:10", stack: expect.stringContaining("boom") });
   });

   it("stops after a limit so a loop can't flood the log", () => {
      const sent: RendererError[] = [];
      const report = createErrorReporter(async (error) => void sent.push(error));
      for (let index = 0; index < 100; index++) report("error", new Error(`error ${index}`));
      expect(sent).toHaveLength(40);
   });

   it("describes values that aren't errors", () => {
      const sent: RendererError[] = [];
      const report = createErrorReporter(async (error) => void sent.push(error));
      report("rejection", { code: 5 });
      const circular: Record<string, unknown> = {};
      circular["self"] = circular;
      report("rejection", circular);
      expect(sent.map((error) => error.message)).toEqual(['{"code":5}', "[object Object]"]);
   });
});
