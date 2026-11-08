import { describe, expect, it } from "vitest";
import { avcCodec } from "./stream";

describe("streamed preview codec", () => {
   it("reads profile, constraints and level from the avcC box", () => {
      const avcC = [0x61, 0x76, 0x63, 0x43, 0x01, 0x64, 0x00, 0x28];
      expect(avcCodec(new Uint8Array([0, 0, 0, 16, ...avcC, 0xff]))).toBe("avc1.640028");
   });

   it("waits for the rest of an init segment that was split mid-box", () => {
      expect(avcCodec(new Uint8Array([0, 0, 0, 16, 0x61, 0x76, 0x63, 0x43, 0x01, 0x64]))).toBeNull();
      expect(avcCodec(new Uint8Array([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
   });
});
