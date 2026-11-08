import { Transform } from "node:stream";
import type { TransformCallback } from "node:stream";

/** Where each track's first sample sits on the source timeline, in seconds. */
export interface TrackStarts {
   video: number;
   audio: number;
}

interface Track {
   timescale: number;
   kind: "video" | "audio" | "other";
   /** Ticks added to every tfdt of this track; fixed by the first fragment. */
   offset: bigint | null;
}

const containers = new Set(["moov", "trak", "mdia", "moof", "traf"]);

function boxType(buffer: Buffer, offset: number): string {
   return buffer.toString("latin1", offset + 4, offset + 8);
}

/**
 * FFmpeg's fragmented MP4 muxer rebases every track to zero, so a stream that starts at a
 * seek point loses its place on the source timeline. This rewrites each fragment's base
 * decode time so the first sample of every track lands exactly where the caller says it
 * starts. Media data passes through untouched; only moov and moof boxes are buffered.
 */
export class Fmp4Retimer extends Transform {
   private readonly starts: TrackStarts;
   private readonly tracks = new Map<number, Track>();
   private header = Buffer.alloc(0);
   /** Bytes of the current mdat (or other pass-through box) still to forward. */
   private passing = 0;
   /** A moov or moof being collected in full before it is rewritten. */
   private collecting: { size: number; parts: Buffer[]; length: number } | null = null;

   constructor(starts: TrackStarts) {
      super();
      this.starts = starts;
   }

   override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
      try {
         this.consume(chunk);
         done();
      } catch (error) {
         done(error instanceof Error ? error : new Error(String(error)));
      }
   }

   override _flush(done: TransformCallback): void {
      done(this.collecting || this.header.length || this.passing > 0 ? new Error("The preview stream ended inside a box.") : null);
   }

   private consume(chunk: Buffer): void {
      let position = 0;
      while (position < chunk.length) {
         if (this.passing > 0) {
            const take = Math.min(this.passing, chunk.length - position);
            this.push(chunk.subarray(position, position + take));
            this.passing -= take;
            position += take;
            continue;
         }
         if (this.collecting) {
            const take = Math.min(this.collecting.size - this.collecting.length, chunk.length - position);
            this.collecting.parts.push(chunk.subarray(position, position + take));
            this.collecting.length += take;
            position += take;
            if (this.collecting.length === this.collecting.size) {
               const box = Buffer.concat(this.collecting.parts);
               this.collecting = null;
               this.push(this.rewrite(box));
            }
            continue;
         }
         // Gather enough bytes for a full box header, including a 64-bit size.
         const need = this.header.length >= 8 && this.header.readUInt32BE(0) === 1 ? 16 : 8;
         const take = Math.min(need - this.header.length, chunk.length - position);
         this.header = Buffer.concat([this.header, chunk.subarray(position, position + take)]);
         position += take;
         if (this.header.length < 8 || (this.header.readUInt32BE(0) === 1 && this.header.length < 16)) continue;
         const small = this.header.readUInt32BE(0);
         const size = small === 1 ? Number(this.header.readBigUInt64BE(8)) : small;
         const type = boxType(this.header, 0);
         if (small === 0 || size < this.header.length) throw new Error(`Unsupported ${type} box in the preview stream.`);
         const header = this.header;
         this.header = Buffer.alloc(0);
         if (type === "moov" || type === "moof") {
            if (size > 64 * 1024 * 1024) throw new Error("The preview stream has an oversized index.");
            this.collecting = { size, parts: [header], length: header.length };
         } else {
            this.push(header);
            this.passing = size - header.length;
         }
      }
   }

   private rewrite(box: Buffer): Buffer {
      const type = boxType(box, 0);
      if (type === "moov") this.readMoov(box, 8, box.length);
      else this.walkMoof(box, 8, box.length);
      return box;
   }

   private readMoov(box: Buffer, start: number, end: number, track?: { id: number; timescale: number; kind: Track["kind"] }): void {
      for (let position = start; position + 8 <= end;) {
         const size = box.readUInt32BE(position);
         const type = boxType(box, position);
         if (size < 8 || position + size > end) break;
         const body = position + 8;
         if (type === "trak") {
            const current = { id: 0, timescale: 0, kind: "other" as Track["kind"] };
            this.readMoov(box, body, position + size, current);
            if (current.id) this.tracks.set(current.id, { timescale: current.timescale, kind: current.kind, offset: null });
         } else if (containers.has(type)) this.readMoov(box, body, position + size, track);
         else if (track && type === "tkhd") track.id = box.readUInt32BE(body + (box[body] === 1 ? 20 : 12));
         else if (track && type === "mdhd") track.timescale = box.readUInt32BE(body + (box[body] === 1 ? 20 : 12));
         else if (track && type === "hdlr") {
            const handler = box.toString("latin1", body + 8, body + 12);
            track.kind = handler === "vide" ? "video" : handler === "soun" ? "audio" : "other";
         }
         position += size;
      }
   }

   private walkMoof(box: Buffer, start: number, end: number): void {
      for (let position = start; position + 8 <= end;) {
         const size = box.readUInt32BE(position);
         if (size < 8 || position + size > end) break;
         if (boxType(box, position) === "traf") this.retimeTraf(box, position + 8, position + size);
         position += size;
      }
   }

   private retimeTraf(box: Buffer, start: number, end: number): void {
      let track: Track | undefined;
      let tfdt = -1;
      let firstOffset = 0;
      for (let position = start; position + 8 <= end;) {
         const size = box.readUInt32BE(position);
         const type = boxType(box, position);
         if (size < 8 || position + size > end) break;
         const body = position + 8;
         if (type === "tfhd") track = this.tracks.get(box.readUInt32BE(body + 4));
         else if (type === "tfdt") tfdt = body;
         else if (type === "trun") firstOffset = firstCompositionOffset(box, body);
         position += size;
      }
      if (!track || tfdt < 0 || track.kind === "other") return;
      const wide = box[tfdt] === 1;
      const current = wide ? box.readBigUInt64BE(tfdt + 4) : BigInt(box.readUInt32BE(tfdt + 4));
      if (track.offset === null) {
         // Video presents its first sample at decode time plus its composition offset.
         const first = current + BigInt(track.kind === "video" ? firstOffset : 0);
         const target = BigInt(Math.round(this.starts[track.kind] * track.timescale));
         track.offset = target - first;
      }
      const next = current + track.offset;
      if (next < 0n) throw new Error("The preview stream starts before the recording.");
      if (wide) box.writeBigUInt64BE(next, tfdt + 4);
      else if (next <= 0xffffffffn) box.writeUInt32BE(Number(next), tfdt + 4);
      else throw new Error("The preview stream needs 64-bit fragment times.");
   }
}

function firstCompositionOffset(box: Buffer, body: number): number {
   const version = box[body]!;
   const flags = box.readUInt32BE(body) & 0xffffff;
   if (!(flags & 0x800) || box.readUInt32BE(body + 4) === 0) return 0;
   let position = body + 8;
   if (flags & 0x1) position += 4;
   if (flags & 0x4) position += 4;
   if (flags & 0x100) position += 4;
   if (flags & 0x200) position += 4;
   if (flags & 0x400) position += 4;
   return version === 1 ? box.readInt32BE(position) : box.readUInt32BE(position);
}
