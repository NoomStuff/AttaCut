import { describe, expect, it } from "vitest";
import { explainExportError } from "./exportErrors";

describe("export error explanations", () => {
   it("replaces FFmpeg's color filter log with a usable next step", () => {
      const log =
         "[aac @ 123] Input buffer exhausted before END element found\nThe filters 'Parsed_setpts_1' and 'format' do not have a common format and automatic conversion is disabled.";
      expect(explainExportError(log)).toContain("color format");
      expect(explainExportError(log)).toContain("Snap to keyframes");
   });
   it("keeps concise export errors and explains common file failures", () => {
      expect(explainExportError("The original file changed. Reopen it before exporting.")).toBe("The original file changed. Reopen it before exporting.");
      expect(explainExportError("ENOSPC: no space left on device")).toContain("destination drive is full");
      expect(explainExportError("Could not open encoder before EOF")).toContain("Try a nearby cut");
   });
});
