import { readFile } from "node:fs/promises";
import { runMedia } from "../../src/main/media/process.ts";

/** Per-frame checksums from framemd5 output; the hash is always the final CSV column. */
export function frameHashes(text: string): string[] {
   return text
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split(",").at(-1)!.trim());
}

export interface SsimRequest {
   /** ffmpeg arguments producing the two compared inputs, e.g. ["-i", original, "-i", output]. */
   inputs: string[];
   /** Filter graph that joins the inputs as [a][b] and applies ssim with a stats_file. */
   filter: string;
   statsPath: string;
}

/** Mean SSIM of a one-frame comparison. Callers own their thresholds. */
export async function ssimScore(request: SsimRequest): Promise<number> {
   await runMedia("ffmpeg", [...request.inputs, "-filter_complex", request.filter, "-frames:v", "1", "-an", "-f", "null", "-"]);
   const stats = await readFile(request.statsPath, "utf8");
   return Number(/All:([\d.]+)/.exec(stats)?.[1]);
}
