import { basename } from "node:path";
import { isAppFailure } from "../shared/failure";
import type { AppFailure, FailureCode } from "../shared/failure";

/** What the failing work was writing, so a message can name the file. */
export interface FailureContext {
   output?: string;
}

/** Translate diagnostics at the process boundary. The renderer uses codes, not FFmpeg text. */
export function appFailure(value: unknown, context: FailureContext = {}): AppFailure {
   if (isAppFailure(value)) return value;
   const error = value as { code?: string; name?: string; message?: string } | null;
   const detail = (error?.message ?? String(value)).slice(-12000);
   const result = (code: FailureCode, message: string, retryable = true): AppFailure => ({ kind: "attacut-error", code, message, detail, retryable });
   const file = context.output ? `"${basename(context.output)}"` : "The file";
   if (error?.name === "AbortError" || /^(?:Cancelled|Canceled|This operation was aborted)\.?$/i.test(detail)) return result("cancelled", "Cancelled");
   if (error?.code === "ENOSPC" || /ENOSPC|no space left on device/i.test(detail))
      return result("disk-full", "The disk is full. Free up some space and try again.");
   if (error?.code === "EBUSY" || /\bEBUSY\b|being used by another process|resource busy/i.test(detail))
      return result("file-busy", `${file} is open in another app. Close it there and try again.`);
   if (error?.code === "EFBIG" || /\bEFBIG\b|file too large/i.test(detail))
      return result("file-too-large", "This drive can't hold files over 4 GB. Export to another drive or export shorter clips.", false);
   if (error?.code === "ENAMETOOLONG" || /ENAMETOOLONG|name too long/i.test(detail))
      return result("path-too-long", "The file name or folder path is too long. Choose a shorter name or a folder closer to the top of the drive.", false);
   if (["EACCES", "EPERM"].includes(error?.code ?? "") || /\bEACCES\b|\bEPERM\b|permission denied|access is denied/i.test(detail))
      return result(
         "permission",
         process.platform === "win32" && context.output
            ? `AttaCut couldn't write ${file}. Close it if it's open in another app, or check the folder's permissions.`
            : "AttaCut doesn't have permission for that. Check the file or folder's permissions and try again."
      );
   if (/^The original file changed\./.test(detail)) return result("source-changed", detail, false);
   if (/^AttaCut couldn't move .+ to the (Recycle Bin|Trash)|^The original .+ is in the (Recycle Bin|Trash)/.test(detail))
      return result("trash", detail, false);
   if (error?.code === "EIO" || /\bEIO\b|input\/output error|Error opening input file|device (is )?not (ready|connected)/i.test(detail))
      return result("source-missing", "AttaCut can't read the video anymore. If its drive was disconnected, reconnect it and try again.");
   if (error?.code === "ENOENT" && context.output)
      return result("folder-missing", "The output folder was moved or deleted while exporting. Choose a folder and export again.");
   if (error?.name === "ZodError" || /^Invalid application request\./.test(detail))
      return result("invalid-request", "This request is no longer valid. Reopen the panel and try again.", false);
   if (/net::ERR_|ENOTFOUND|ERR_CONNECTION_|ERR_INTERNET_|\bETIMEDOUT\b|network timeout/i.test(detail))
      return result("network", "AttaCut couldn't reach the internet. Check your connection and try again.");
   const permanent = /No output was published|No video frames were produced|partial export was removed|unsupported|Reopen the source video/i.test(detail);
   return result(permanent ? "media" : "unknown", detail, !permanent);
}
