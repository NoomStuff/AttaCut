import type { MediaSource, MediaStream } from "../shared/media";

function duration(seconds: number): string {
   const total = Math.round(seconds);
   const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
   return parts[0]
      ? `${parts[0]}h${String(parts[1]).padStart(2, "0")}m${String(parts[2]).padStart(2, "0")}s`
      : `${parts[1]}m${String(parts[2]).padStart(2, "0")}s`;
}

function size(bytes: number): string {
   if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
   return `${Math.max(0, Math.round(bytes / 1024 ** 2))} MB`;
}

function stream(stream: MediaStream): string {
   const parts = [stream.type, stream.codec];
   if (stream.type === "video") {
      if (stream.attachedPicture) parts.push("cover");
      else {
         parts.push(`${stream.width}x${stream.height}`);
         if (stream.frameRate) parts.push(`${Math.round(stream.frameRate * 100) / 100}fps`);
         if (stream.pixelFormat) parts.push(stream.pixelFormat);
         if (stream.colorTransfer && stream.colorTransfer !== "unknown") parts.push(stream.colorTransfer);
         if (stream.fieldOrder && !["progressive", "unknown"].includes(stream.fieldOrder)) parts.push(stream.fieldOrder);
      }
   }
   if (stream.type === "audio") {
      if (stream.channels) parts.push(`${stream.channels}ch`);
      if (stream.sampleRate) parts.push(`${stream.sampleRate / 1000}kHz`);
   }
   return parts.join(" ");
}

/**
 * The shape of a source for the log: container, length, size and each stream's codec.
 * Never the file name, track titles or tags, which can say more about the user than the bug.
 */
export function describeSource(source: Pick<MediaSource, "extension" | "duration" | "size" | "streams">): string {
   const streams = source.streams.map(stream);
   const counted = streams.reduce<Array<[string, number]>>((groups, text) => {
      const last = groups.at(-1);
      if (last && last[0] === text) last[1]++;
      else groups.push([text, 1]);
      return groups;
   }, []);
   const list = counted.map(([text, count]) => (count > 1 ? `${text} x${count}` : text)).join("; ");
   return `${source.extension.replace(/^\./, "") || "(no extension)"}, ${duration(source.duration)}, ${size(source.size)}; ${list || "no streams"}`;
}
