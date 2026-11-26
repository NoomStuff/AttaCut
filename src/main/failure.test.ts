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
it("keeps the specific wording of refusals made before an export starts", () => {
   expect(
      appFailure(
         Object.assign(new Error("\"a.mp4\" is too big for this drive's Recycle Bin, so AttaCut won't replace it."), { code: "ETRASH", permanent: true })
      )
   ).toMatchObject({
      code: "trash",
      retryable: false,
   });
   expect(appFailure(Object.assign(new Error("AttaCut couldn't move it."), { code: "ETRASH", permanent: false }))).toMatchObject({
      code: "trash",
      retryable: true,
   });
   const space = 'There isn\'t enough free space for "a.mp4". It needs about 2.0 GB, and the drive has 1.0 GB free.';
   expect(appFailure(Object.assign(new Error(space), { code: "ENOSPC" })).message).toBe(space);
   expect(appFailure(new Error("The original file was moved or deleted. Locate it, then export again."))).toMatchObject({
      code: "source-moved",
      retryable: true,
   });
   expect(appFailure(Object.assign(new Error("busy"), { code: "EBUSY" }), { output: "/out/clip.mp4" }).message).toContain('"clip.mp4" is open in another app');
});
