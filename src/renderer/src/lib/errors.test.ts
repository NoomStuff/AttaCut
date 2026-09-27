import { expect, it } from "vitest";
import { errorText } from "./errors";

it("keeps plain messages and strips IPC wrappers", () => {
   expect(errorText(new Error("The original file changed. Reopen it before exporting."))).toBe("The original file changed. Reopen it before exporting.");
   expect(errorText(new Error("Error invoking remote method 'source:open': Error: Choose a video file."))).toBe("Choose a video file.");
});

it("rewords common OS and network failures", () => {
   expect(errorText(new Error("ENOSPC: no space left on device, write"))).toBe("The disk is full. Free up some space and try again.");
   expect(errorText(new Error("EACCES: permission denied, open 'C:\\video.mp4'"))).toBe(
      "AttaCut doesn't have permission for that. Check the file or folder's permissions and try again."
   );
   expect(errorText(new Error("net::ERR_INTERNET_DISCONNECTED"))).toBe("AttaCut couldn't reach the internet. Check your connection and try again.");
   expect(errorText(new Error("getaddrinfo ENOTFOUND github.com"))).toBe("AttaCut couldn't reach the internet. Check your connection and try again.");
   expect(errorText(new Error("network timeout at 15000ms"))).toBe("AttaCut couldn't reach the internet. Check your connection and try again.");
});

it("leaves flow-specific wording for callers to contextualize", () => {
   expect(errorText(new Error("ENOENT: no such file or directory, stat 'C:\\video.mp4'"))).toContain("no such file or directory");
   expect(errorText(new Error("moov atom not found"))).toBe("moov atom not found");
});
