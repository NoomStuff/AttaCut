export type FailureCode =
   | "cancelled"
   | "disk-full"
   | "permission"
   | "file-busy"
   | "file-too-large"
   | "path-too-long"
   | "folder-missing"
   | "source-changed"
   | "source-moved"
   | "source-missing"
   | "trash"
   | "invalid-request"
   | "network"
   | "media"
   | "unknown";
export interface AppFailure {
   kind: "attacut-error";
   code: FailureCode;
   message: string;
   detail: string;
   retryable: boolean;
}
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppFailure };
export function isAppFailure(value: unknown): value is AppFailure {
   return (
      typeof value === "object" &&
      value !== null &&
      "kind" in value &&
      value.kind === "attacut-error" &&
      "message" in value &&
      typeof value.message === "string"
   );
}
