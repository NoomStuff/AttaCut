import { expect, it } from "vitest";
import { appFailure } from "./failure";

it("distinguishes explicit cancellation from diagnostics containing cancel", () => {
   expect(appFailure(new DOMException("This operation was aborted", "AbortError")).code).toBe("cancelled");
   expect(appFailure(new Error("Cancelled")).code).toBe("cancelled");
   expect(appFailure(new Error("Could not cancel an invalid codec operation")).code).toBe("unknown");
});
it("preserves bounded diagnostics and prevents retrying an immutable plan after its source changed", () => {
   expect(appFailure(new Error("The original file changed. Reopen it before exporting."))).toMatchObject({ code: "source-changed", retryable: false });
   const disk = appFailure(Object.assign(new Error("Write failed"), { code: "ENOSPC" }));
   expect(disk).toMatchObject({ code: "disk-full", retryable: true, detail: "Write failed" });
   expect(JSON.parse(JSON.stringify(disk))).toEqual(disk);
   expect(appFailure(new Error("x".repeat(20000))).detail.length).toBe(12000);
});
