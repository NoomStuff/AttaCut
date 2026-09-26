import { describe, expect, it } from "vitest";
import { readElement, readVint } from "./mkv-index.ts";

describe("readVint", () => {
   it("reads one-byte ids with the marker bit intact", () => {
      expect(readVint(Buffer.from([0xbb]), 0, 1, false)).toEqual({ value: 0xbb, next: 1, unknown: false });
   });
   it("reads multi-byte ids", () => {
      const data = Buffer.from([0x18, 0x53, 0x80, 0x67]);
      expect(readVint(data, 0, data.length, false)).toEqual({ value: 0x18538067, next: 4, unknown: false });
   });
   it("masks the size marker bit", () => {
      expect(readVint(Buffer.from([0x81]), 0, 1, true)!.value).toBe(1);
      expect(readVint(Buffer.from([0x40, 0x3c]), 0, 2, true)!.value).toBe(60);
   });
   it("recognizes unknown sizes as all-ones data bits", () => {
      const unknown = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
      expect(readVint(unknown, 0, unknown.length, true)!.unknown).toBe(true);
      const known = Buffer.from([0x01, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
      expect(readVint(known, 0, known.length, true)!.unknown).toBe(false);
   });
   it("rejects truncated and oversized integers", () => {
      expect(readVint(Buffer.from([0x40]), 0, 1, true)).toBeNull();
      // A leading zero byte would need nine length bytes; EBML allows at most eight.
      expect(readVint(Buffer.from([0x00, 0xff]), 0, 2, true)).toBeNull();
      expect(readVint(Buffer.alloc(0), 0, 0, false)).toBeNull();
   });
});
describe("readElement", () => {
   it("parses an element header and body range", () => {
      const data = Buffer.from([0x18, 0x53, 0x80, 0x67, 0x84, 0x01, 0x02, 0x03, 0x04]);
      const element = readElement(data)!;
      expect(element.id).toBe(0x18538067);
      expect(element.size).toBe(4);
      expect(element.bodyStart).toBe(5);
      expect(element.bodyEnd).toBe(9);
   });
   it("reports unknown size as null", () => {
      const data = Buffer.from([0xbb, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
      expect(readElement(data)!.size).toBeNull();
   });
   it("rejects a declared size that overruns the buffer", () => {
      const data = Buffer.from([0xbb, 0x83, 0x01, 0x02]);
      expect(readElement(data)).toBeNull();
   });
   it("rejects truncated headers", () => {
      expect(readElement(Buffer.from([0x18, 0x53]))).toBeNull();
   });
});
