import { writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Clip } from "../../shared/types.ts";
import type { ProbedSource } from "./probe.ts";
import { runMedia } from "./process.ts";

export const textSubtitleCodecs = new Set(["subrip", "ass", "ssa", "mov_text", "webvtt", "text"]);
function assTime(value: string): number {
   const [h, m, s] = value.split(":").map(Number);
   return h! * 3600 + m! * 60 + s!;
}
function formatAss(value: number): string {
   const centiseconds = Math.round(value * 100);
   return `${Math.floor(centiseconds / 360000)}:${String(Math.floor(centiseconds / 6000) % 60).padStart(2, "0")}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}
export function trimAss(text: string, start: number, end: number): string {
   return text
      .split(/\r?\n/)
      .flatMap((line) => {
         if (!line.startsWith("Dialogue:")) return [line];
         const fields = line.split(",");
         const begin = Math.max(start, assTime(fields[1]!));
         const finish = Math.min(end, assTime(fields[2]!));
         if (finish <= begin) return [];
         fields[1] = formatAss(begin - start);
         fields[2] = formatAss(finish - start);
         return [fields.join(",")];
      })
      .join("\n");
}
export async function metadataInputs(
   source: ProbedSource,
   clip: Clip,
   directory: string,
   destination: string,
   signal?: AbortSignal
): Promise<{ inputs: string[]; outputs: string[] }> {
   const inputs: string[] = [];
   const outputs: string[] = [];
   let nextInput = 2;
   let subtitleIndex = 0;
   const mp4 = [".mp4", ".m4v", ".mov"].includes(extname(destination).toLowerCase());
   for (const stream of source.streams.filter((item) => item.type === "subtitle")) {
      const ass = await runMedia("ffmpeg", ["-v", "error", "-i", source.path, "-map", `0:${stream.index}`, "-c:s", "ass", "-f", "ass", "-"], {
         signal,
      });
      const path = join(directory, `subtitles-${subtitleIndex}.ass`);
      // FFmpeg subtitle extraction starts at the input's format start time.
      await writeFile(path, trimAss(ass, clip.start, clip.end));
      inputs.push("-i", path);
      outputs.push(
         "-map",
         `${nextInput++}:s:0`,
         `-c:s:${subtitleIndex}`,
         mp4 ? "mov_text" : extname(destination) === ".webm" ? "webvtt" : stream.codec === "mov_text" ? "subrip" : stream.codec
      );
      outputs.push(
         `-metadata:s:s:${subtitleIndex}`,
         `language=${stream.language || "und"}`,
         `-metadata:s:s:${subtitleIndex}`,
         `title=${stream.title}`,
         `-disposition:s:${subtitleIndex}`,
         Object.entries(stream.disposition)
            .filter(([, value]) => value === 1)
            .map(([name]) => name)
            .join("+") || "0"
      );
      subtitleIndex++;
   }
   for (const [index, stream] of source.streams.filter((item) => item.type === "attachment").entries())
      outputs.push("-map", `1:${stream.index}`, `-map_metadata:s:t:${index}`, `1:s:${stream.index}`);
   for (const [index, stream] of source.streams.filter((item) => item.type === "audio").entries())
      outputs.push(
         `-map_metadata:s:a:${index}`,
         `1:s:${stream.index}`,
         `-disposition:a:${index}`,
         Object.entries(stream.disposition)
            .filter(([, value]) => value === 1)
            .map(([name]) => name)
            .join("+") || "0"
      );
   const escape = (value: string) => value.replace(/[\\=;#\n\r]/g, (character) => `\\${character}`);
   const chapters = source.chapters
      .filter((chapter) => chapter.end > clip.start && chapter.start < clip.end)
      .map(
         (chapter) =>
            `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round((Math.max(chapter.start, clip.start) - clip.start) * 1000)}\nEND=${Math.round((Math.min(chapter.end, clip.end) - clip.start) * 1000)}\ntitle=${escape(chapter.title)}\n`
      );
   if (chapters.length) {
      const path = join(directory, "chapters.ffmetadata");
      await writeFile(path, `;FFMETADATA1\n${chapters.join("")}`);
      inputs.push("-f", "ffmetadata", "-i", path);
      outputs.push("-map_chapters", String(nextInput));
   } else outputs.push("-map_chapters", "-1");
   return { inputs, outputs };
}
