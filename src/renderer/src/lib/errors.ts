export function errorText(value: unknown): string {
   const message = value instanceof Error ? value.message : String(value);
   if (/reply was never sent/i.test(message)) {
      const channel = /remote method '([^']+)'/.exec(message)?.[1];
      const action = channel?.startsWith("export:")
         ? "The export request"
         : channel === "directory:choose" || channel === "source:choose"
           ? "The file picker"
           : "The request";
      return `${action} did not receive a response from AttaCut. Try again. If it keeps happening, restart AttaCut.`;
   }
   const text = message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
   // Common OS and network failures reworded once, so every surface explains instead of
   // echoing errno strings. Situations tied to one flow rewrite them further with context.
   if (/ENOSPC|no space left on device/i.test(text)) return "The disk is full. Free up some space and try again.";
   if (/\bEACCES\b|\bEPERM\b|permission denied|access is denied/i.test(text))
      return "AttaCut doesn't have permission for that. Check the file or folder's permissions and try again.";
   if (/net::ERR_|ENOTFOUND|ERR_CONNECTION_|ERR_INTERNET_|\bETIMEDOUT\b|network timeout/i.test(text))
      return "AttaCut couldn't reach the internet. Check your connection and try again.";
   return text;
}
/** The main process cancels work by rejecting with "Cancelled"; match that in one place. */
export function isCancellation(message: string): boolean {
   return /cancel/i.test(message);
}
