/** Align every input to the output origin before mixing. amix alone combines samples
    from unequal track starts as though they started together. */
export function alignedAudioFilters(indices: string[], rate: number, layout: string | undefined, duration: number, start = 0): string[] {
   const align = `aresample=${rate}:async=1:first_pts=${Math.round(start * rate)}`;
   const trim = start ? `atrim=start=${start}:end=${start + duration},asetpts=PTS-STARTPTS,` : "";
   const end = `${trim}apad,atrim=end=${duration}`;
   if (indices.length === 1) return ["-map", indices[0]!, "-af", `${align},${end}`];
   // Preserve the source mixing layout before mono reduction, or a mono input's
   // gain changes when FFmpeg negotiates the output layout at amix.
   const mixLayout = layout ? `,aformat=channel_layouts=${layout}` : "";
   return [
      "-filter_complex",
      `${indices.map((index, i) => `[${index}]${align}[t${i}]`).join(";")};${indices.map((_, i) => `[t${i}]`).join("")}amix=inputs=${indices.length}:duration=longest${mixLayout},${end}[a]`,
      "-map",
      "[a]",
   ];
}
