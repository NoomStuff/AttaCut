export function clamp(value: number, min: number, max: number): number {
   return Math.min(max, Math.max(min, value));
}
export function formatTime(seconds: number, precision = 2): string {
   const safe = Math.max(0, seconds);
   const factor = 10 ** precision;
   const ticks = Math.round(safe * factor);
   const hours = Math.floor(ticks / (3600 * factor));
   const minutes = Math.floor(ticks / (60 * factor)) % 60;
   const secs = (ticks % (60 * factor)) / factor;
   return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${secs.toFixed(precision).padStart(precision ? 3 + precision : 2, "0")}`;
}
export function parseTime(text: string): number | null {
   const parts = text.trim().split(":");
   if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) return null;
   const values = parts.map(Number);
   if (values.slice(1).some((part) => part >= 60)) return null;
   return values.reduce((sum, part) => sum * 60 + part, 0);
}
