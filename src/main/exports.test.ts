import { describe, expect, it } from "vitest";
import { sanitizeName } from "./exports";
describe("output filenames", () => {
   it("removes filesystem syntax and reserved Windows device names", () => {
      expect(sanitizeName("a:b?c")).toBe("a_b_c");
      expect(sanitizeName("CON")).toBe("clip-CON");
      expect(sanitizeName("clip. ")).toBe("clip");
      expect(sanitizeName("..")).toBe("clip-untitled");
   });
});
