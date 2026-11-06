import { isAppFailure } from "../../../shared/failure";

/** IPC failures arrive already worded by the main process. Only Electron's own transport errors need it here. */
export function errorText(value: unknown): string {
   if (isAppFailure(value)) return value.message;
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
   return message;
}
/** The main process cancels work by rejecting with "Cancelled"; match that in one place. */
export function isCancellation(message: string): boolean {
   return /^(?:Cancelled|Canceled|AbortError: This operation was aborted|This operation was aborted)\.?$/i.test(message);
}
