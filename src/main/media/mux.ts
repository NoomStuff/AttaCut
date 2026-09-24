/**
 * Serializers shared by the separate and combined export paths. These two paths build the
 * same mux structures independently; keeping the text formats in one module is what stops
 * them from drifting into combined-mode-only corruption.
 */

/** One ffconcat list; paths are escaped for the demuxer's single-quote format. */
export function ffconcatList(paths: string[], durations: number[]): string {
   return `ffconcat version 1.0\n${paths
      .map((path, index) => `file '${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'\nduration ${durations[index]!}`)
      .join("\n")}\n`;
}

/** Disposition flags for one output stream; "0" tells ffmpeg to inherit nothing. */
export function dispositionFlags(disposition: Record<string, number>): string {
   return (
      Object.entries(disposition)
         .filter(([, value]) => value === 1)
         .map(([name]) => name)
         .join("+") || "0"
   );
}

/** Codecs whose packets can be re-cut without quality loss but not concatenated as-is. */
export function isLosslessAudio(codec: string): boolean {
   return ["flac", "alac", "wavpack"].includes(codec) || codec.startsWith("pcm_");
}

export interface ChapterMark {
   start: number;
   end: number;
   title: string;
}

/** Serialize chapters into an FFMETADATA file body; times are seconds. */
export function serializeChapters(chapters: ChapterMark[]): string {
   return `;FFMETADATA1\n${chapters
      .map(
         (chapter) =>
            `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(chapter.start * 1000)}\nEND=${Math.round(chapter.end * 1000)}\ntitle=${chapter.title.replace(/[\\=;#\n\r]/g, (character) => `\\${character}`)}\n`
      )
      .join("")}`;
}
