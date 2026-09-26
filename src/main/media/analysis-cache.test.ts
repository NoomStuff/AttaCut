import { describe, expect, it, vi } from "vitest";
import { packetsAround } from "./probe.ts";
import { runMedia } from "./process.ts";
import type { ProbedSource } from "./probe.ts";
vi.mock("./process.ts", () => ({ runMedia: vi.fn(async () => JSON.stringify({ packets: [{ pts_time: "0", dts_time: "0", flags: "K" }] })) }));
describe("packet window reuse", () => {
   it("shares overlapping probes across 500 clips and their second planning pass", async () => {
      const source = { path: "recording.mp4", startOffset: 0, streams: [{ type: "video", index: 0 }] } as ProbedSource;
      for (let pass = 0; pass < 2; pass++) {
         for (let clip = 0; clip < 500; clip++) await Promise.all([packetsAround(source, clip * 0.1), packetsAround(source, clip * 0.1 + 0.1)]);
      }
      expect(runMedia).toHaveBeenCalledTimes(1);
   });
});
