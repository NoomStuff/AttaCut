import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { runMedia } from "./process.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

function childProcess() {
   const child = Object.assign(new EventEmitter(), {
      pid: 123,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(() => true),
   });
   vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
   return child;
}

afterEach(() => {
   vi.useRealTimers();
   vi.clearAllMocks();
});

it("waits for child closure on cancellation and escalates a child that ignores termination", async () => {
   vi.useFakeTimers();
   const child = childProcess();
   const controller = new AbortController();
   let settled = false;
   const pending = runMedia("ffmpeg", [], { signal: controller.signal }).finally(() => {
      settled = true;
   });
   const rejected = expect(pending).rejects.toThrow("Cancelled");
   controller.abort();
   await Promise.resolve();
   expect(child.kill).toHaveBeenCalledTimes(1);
   expect(settled).toBe(false);
   await vi.advanceTimersByTimeAsync(5000);
   expect(child.kill).toHaveBeenLastCalledWith("SIGKILL");
   expect(settled).toBe(false);
   child.emit("close", null);
   await rejected;
   expect(vi.getTimerCount()).toBe(0);
});

it("does not spawn already cancelled work", async () => {
   await expect(runMedia("ffprobe", [], { signal: AbortSignal.abort() })).rejects.toThrow("Cancelled");
   expect(spawn).not.toHaveBeenCalled();
});

it("reports a missing executable without waiting for close", async () => {
   const child = childProcess();
   Object.assign(child, { pid: undefined });
   const pending = runMedia("ffprobe", []);
   child.emit("error", new Error("spawn ENOENT"));
   await expect(pending).rejects.toThrow("ffprobe was not found");
});
