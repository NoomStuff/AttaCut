import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import type { ProbedSource } from "./probe.ts";

/**
 * Read an MKV/WebM Cues index without touching the media payload, mirroring the MP4
 * sample-table parser. Only element headers, Info, Tracks, SeekHead and Cues are read
 * from disk, so a multi-hour recording indexes as fast as a short one.
 */

const Segment = 0x18538067;
const SeekHead = 0x114d9b74;
const Seek = 0x4dbb;
const SeekId = 0x53ab;
const SeekPosition = 0x53ac;
const Info = 0x1549a966;
const TimestampScale = 0x2ad7b1;
const Tracks = 0x1654ae6b;
const TrackEntry = 0xae;
const TrackNumber = 0xd7;
const TrackType = 0x83;
const Cluster = 0x1f43b675;
const Cues = 0x1c53bb6b;
const CuePoint = 0xbb;
const CueTime = 0xb3;
const CueTrackPositions = 0xb7;
const CueTrack = 0xf7;

/** Total bytes read from disk across the whole parse; far above any real index size. */
const readLimit = 64 * 1024 * 1024;
const maxIndexBody = 32 * 1024 * 1024;

export interface EbmlElement {
   id: number;
   size: number | null;
   bodyStart: number;
   bodyEnd: number;
}
interface Vint {
   value: number;
   next: number;
   unknown: boolean;
}
/** EBML variable-length integer; the first byte's leading zeros give the length. */
export function readVint(data: Buffer, offset: number, end: number, masked: boolean): Vint | null {
   if (offset >= end) return null;
   const first = data[offset]!;
   const leadingZeros = Math.clz32(first) - 24;
   const length = leadingZeros + 1;
   if (length > 8 || offset + length > end) return null;
   let value = masked ? first & ((1 << (7 - leadingZeros)) - 1) : first;
   // A size vint with every data bit set means "unknown size" (live streams); ids cannot say that.
   let unknown = masked && value === (1 << (7 - leadingZeros)) - 1;
   for (let index = 1; index < length; index++) {
      const byte = data[offset + index]!;
      if (masked && byte !== 0xff) unknown = false;
      value = value * 256 + byte;
   }
   return { value, next: offset + length, unknown };
}
/**
 * Parse one element header. With strict parsing (default, full buffers) a declared size that
 * overruns the buffer means truncated data; scanner windows pass strict=false because element
 * bodies legitimately extend past the 16 header bytes read from disk. Returned offsets are
 * relative to `data`; the caller translates them with the window's file position.
 */
export function readElement(data: Buffer, offset = 0, end = data.length, strict = true): EbmlElement | null {
   const id = readVint(data, offset, end, false);
   if (!id || id.unknown) return null;
   const size = readVint(data, id.next, end, true);
   if (!size) return null;
   if (size.unknown) return { id: id.value, size: null, bodyStart: size.next, bodyEnd: end };
   if (size.next + size.value > end && strict) return null;
   return { id: id.value, size: size.value, bodyStart: size.next, bodyEnd: size.next + size.value };
}
/** Unsigned integer element data is plain big-endian; only element ids and sizes are vints. */
function uint(data: Buffer, element: EbmlElement): number | null {
   if (element.size === null || element.size > 8) return null;
   let value = 0;
   for (let index = element.bodyStart; index < element.bodyEnd; index++) value = value * 256 + data[index]!;
   return value;
}

class Scanner {
   constructor(
      private handle: FileHandle,
      private budget: { remaining: number }
   ) {}
   position = 0;
   /** Read up to the length from the current position without advancing it; null ends the walk. */
   async data(length: number): Promise<Buffer | null> {
      if (length > this.budget.remaining) return null;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await this.handle.read(buffer, 0, length, this.position);
      if (bytesRead === 0) return null;
      this.budget.remaining -= bytesRead;
      return buffer.subarray(0, bytesRead);
   }
}

/** Parse children of a master element body with the pure header reader. */
function children(data: Buffer, start: number, end: number, visit: (element: EbmlElement) => void): void {
   let offset = start;
   while (offset < end) {
      const element = readElement(data, offset, end);
      if (!element) return;
      visit(element);
      offset = element.bodyEnd;
   }
}

/** Video track numbers referenced by TrackType 1 entries. */
function videoTracks(data: Buffer): number[] {
   const numbers: number[] = [];
   children(data, 0, data.length, (element) => {
      if (element.id !== TrackEntry) return;
      let number: number | null = null;
      let type = 0;
      children(data, element.bodyStart, element.bodyEnd, (child) => {
         if (child.id === TrackNumber) number = uint(data, child);
         if (child.id === TrackType) type = uint(data, child) ?? 0;
      });
      if (type === 1 && number !== null) numbers.push(number);
   });
   return numbers;
}

/** Keyframe timestamps in seconds from a Cues body, filtered to one track. */
function cueTimes(data: Buffer, scale: number, track: number): number[] {
   const times: number[] = [];
   children(data, 0, data.length, (element) => {
      if (element.id !== CuePoint) return;
      let time: number | null = null;
      const tracks: number[] = [];
      children(data, element.bodyStart, element.bodyEnd, (child) => {
         if (child.id === CueTime) time = uint(data, child);
         if (child.id === CueTrackPositions)
            children(data, child.bodyStart, child.bodyEnd, (position) => {
               if (position.id === CueTrack) {
                  const value = uint(data, position);
                  if (value !== null) tracks.push(value);
               }
            });
      });
      if (time !== null && (tracks.length === 0 || tracks.includes(track))) times.push((time * scale) / 1e9);
   });
   return times;
}

/** TimestampScale in nanoseconds per timestamp unit; the Matroska default is one millisecond. */
function timestampScale(data: Buffer): number {
   let scale = 1_000_000;
   children(data, 0, data.length, (element) => {
      if (element.id === TimestampScale) scale = uint(data, element) ?? 1_000_000;
   });
   return scale;
}

/** SeekHead positions are relative to the Segment body start. */
function seekTarget(data: Buffer, wanted: number): number | null {
   let target: number | null = null;
   children(data, 0, data.length, (element) => {
      if (element.id !== Seek) return;
      let id: number | null = null;
      let position: number | null = null;
      children(data, element.bodyStart, element.bodyEnd, (child) => {
         if (child.id === SeekId) id = readVint(data, child.bodyStart, child.bodyEnd, false)?.value ?? null;
         if (child.id === SeekPosition) position = uint(data, child);
      });
      if (id === wanted && position !== null) target = position;
   });
   return target;
}

async function readBody(scanner: Scanner, base: number, element: EbmlElement, limit: number): Promise<Buffer | null> {
   if (element.size === null || element.size > limit) return null;
   scanner.position = base + element.bodyStart;
   const body = await scanner.data(element.size);
   return body && body.length === element.size ? body : null;
}

export async function indexedMkvKeyframes(source: ProbedSource, signal?: AbortSignal): Promise<number[] | null> {
   if (![".mkv", ".webm"].includes(source.extension)) return null;
   const handle = await open(source.path, "r");
   const budget = { remaining: readLimit };
   try {
      const scanner = new Scanner(handle, budget);
      // Walk top-level elements to the Segment; the EBML header and Void elements are skipped.
      let segmentStart = -1;
      let segmentEnd = source.size;
      scanner.position = 0;
      while (scanner.position < source.size) {
         signal?.throwIfAborted();
         const base = scanner.position;
         const header = await scanner.data(16);
         if (!header) return null;
         const element = readElement(header, 0, header.length, false);
         if (!element) return null;
         if (element.id === Segment && element.size !== null) {
            segmentStart = base + element.bodyStart;
            segmentEnd = segmentStart + element.size;
            break;
         }
         if (element.size === null || base + element.bodyStart + element.size > source.size) return null;
         scanner.position = base + element.bodyStart + element.size;
      }
      if (segmentStart < 0) return null;
      let scale = 1_000_000;
      let track: number | null = null;
      let cuesFromSeek: number | null = null;
      let cues: number[] | null = null;
      scanner.position = segmentStart;
      while (scanner.position < segmentEnd) {
         signal?.throwIfAborted();
         const base = scanner.position;
         const header = await scanner.data(16);
         if (!header) break;
         const element = readElement(header, 0, header.length, false);
         // A null size here (live-streamed Segment children) or corrupt headers bail to packet scanning.
         if (!element || element.size === null) return null;
         const bodyEnd = base + element.bodyStart + element.size;
         if (element.id === Info) {
            const body = await readBody(scanner, base, element, 1_000_000);
            if (!body) return null;
            scale = timestampScale(body);
         } else if (element.id === Tracks) {
            const body = await readBody(scanner, base, element, 8_000_000);
            if (!body) return null;
            const numbers = videoTracks(body);
            if (numbers.length !== 1) return null;
            track = numbers[0]!;
         } else if (element.id === SeekHead) {
            const body = await readBody(scanner, base, element, 1_000_000);
            if (!body) return null;
            const position = seekTarget(body, Cues);
            if (position !== null) cuesFromSeek = segmentStart + position;
         } else if (element.id === Cues) {
            const body = await readBody(scanner, base, element, maxIndexBody);
            if (!body) return null;
            if (track === null) return null;
            cues = cueTimes(body, scale, track);
            break;
         } else if (element.id === Cluster && track !== null && cuesFromSeek !== null) {
            // The Cue index sits behind every cluster; jump there instead of walking the payload.
            const cueBase = cuesFromSeek;
            scanner.position = cueBase;
            const cueHeader = await scanner.data(16);
            const cueElement = cueHeader ? readElement(cueHeader, 0, cueHeader.length, false) : null;
            if (!cueElement || cueElement.id !== Cues) return null;
            const body = await readBody(scanner, cueBase, cueElement, maxIndexBody);
            if (!body) return null;
            cues = cueTimes(body, scale, track);
            break;
         }
         // Clusters are skipped by position alone, whatever their size.
         scanner.position = bodyEnd;
      }
      if (!cues) return null;
      const points = [
         ...new Set(
            cues
               .map((time) => time - source.startOffset)
               .filter((time) => Number.isFinite(time) && time >= -0.000001 && time <= source.duration)
               .map((time) => Math.max(0, time))
         ),
      ].sort((a, b) => a - b);
      return points.length ? points : null;
   } catch (error) {
      if (signal?.aborted) throw error;
      return null;
   } finally {
      await handle.close();
   }
}
