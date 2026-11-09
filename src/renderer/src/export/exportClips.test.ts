import { describe, expect, it } from "vitest";
import { coverageChange } from "./exportClips";

describe("export ranges", () => {
   it("measures what moving cuts to keyframes adds and drops", () => {
      expect(coverageChange([{ start: 1, end: 5 }], [{ start: 0.5, end: 4 }])).toEqual({ added: 0.5, dropped: 1 });
      expect(
         coverageChange(
            [
               { start: 0, end: 2 },
               { start: 2, end: 4 },
            ],
            [{ start: 0, end: 4 }]
         )
      ).toEqual({ added: 0, dropped: 0 });
      expect(coverageChange([{ start: 1, end: 2 }], [{ start: 3, end: 4 }])).toEqual({ added: 1, dropped: 1 });
   });
});
