import { expect, it } from "vitest";
import { errorText } from "./errors";

it("shows the main process wording for IPC failures and plain messages otherwise", () => {
   const failure = {
      kind: "attacut-error",
      code: "disk-full",
      message: "The disk is full. Free up some space and try again.",
      detail: "ENOSPC",
      retryable: true,
   };
   expect(errorText(failure)).toBe(failure.message);
   expect(errorText(new Error("moov atom not found"))).toBe("moov atom not found");
});

it("explains a request whose reply never arrived", () => {
   expect(errorText(new Error("Error invoking remote method 'export:plan': reply was never sent"))).toMatch(/^The export request did not receive a response/);
   expect(errorText(new Error("Error invoking remote method 'source:choose': reply was never sent"))).toMatch(/^The file picker/);
});
