export function errorText(value: unknown): string {
   return (value instanceof Error ? value.message : String(value)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
