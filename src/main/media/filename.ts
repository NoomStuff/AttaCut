export function sanitizeName(value: string): string {
   const clean = Array.from(value, (character) => (character.charCodeAt(0) < 32 ? "_" : character))
      .join("")
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/[. ]+$/, "")
      .trim();
   if (!clean || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean)) return `clip-${clean || "untitled"}`;
   return clean.slice(0, 180);
}
