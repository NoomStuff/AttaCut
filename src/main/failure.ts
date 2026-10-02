import { isAppFailure } from "../shared/failure";
import type { AppFailure, FailureCode } from "../shared/failure";

/** Translate diagnostics at the process boundary. The renderer uses codes, not FFmpeg text. */
export function appFailure(value: unknown): AppFailure {
   if (isAppFailure(value)) return value;
   const error = value as { code?: string; name?: string; message?: string } | null;
   const detail = (error?.message ?? String(value)).slice(-12000);
   const result = (code: FailureCode, message: string, retryable = true): AppFailure => ({ kind: "attacut-error", code, message, detail, retryable });
   if (error?.name === "AbortError" || /^(?:Cancelled|Canceled|This operation was aborted)\.?$/i.test(detail)) return result("cancelled", "Cancelled");
   if (error?.code === "ENOSPC" || /ENOSPC|no space left on device/i.test(detail))
      return result("disk-full", "The disk is full. Free up some space and try again.");
   if (["EACCES", "EPERM"].includes(error?.code ?? "") || /\bEACCES\b|\bEPERM\b|permission denied|access is denied/i.test(detail))
      return result("permission", "AttaCut doesn't have permission for that. Check the file or folder's permissions and try again.");
   if (/^The original file changed\./.test(detail)) return result("source-changed", detail, false);
   if (error?.name === "ZodError" || /^Invalid application request\./.test(detail))
      return result("invalid-request", "This request is no longer valid. Reopen the panel and try again.", false);
   if (/net::ERR_|ENOTFOUND|ERR_CONNECTION_|ERR_INTERNET_|\bETIMEDOUT\b|network timeout/i.test(detail))
      return result("network", "AttaCut couldn't reach the internet. Check your connection and try again.");
   const permanent = /No output was published|No video frames were produced|partial export was removed|unsupported|Reopen the source video/i.test(detail);
   return result(permanent ? "media" : "unknown", detail, !permanent);
}
