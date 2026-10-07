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

it("bounds asynchronous binary consumption and disarms the idle timer while paused", async () => {
   vi.useFakeTimers();
   const child = childProcess();
   let resume!: () => void;
   const consumed: number[] = [];
   const pending = runMedia("ffmpeg", [], {
      idleTimeoutMs: 100,
      onBytes: async (chunk) => {
         consumed.push(chunk[0]!);
         if (consumed.length === 1)
            await new Promise<void>((resolve) => {
               resume = resolve;
            });
      },
   });
   child.stdout.write(Buffer.from([1]));
   child.stdout.write(Buffer.from([2]));
   await vi.advanceTimersByTimeAsync(200);
   expect(consumed).toEqual([1]);
   expect(child.kill).not.toHaveBeenCalled();
   resume();
   await vi.advanceTimersByTimeAsync(0);
   expect(consumed).toEqual([1, 2]);
   child.emit("close", 0);
   await pending;
});

it("waits for the last asynchronous consumer and rejects its failure", async () => {
   const child = childProcess();
   let fail!: (error: Error) => void;
   const pending = runMedia("ffmpeg", [], {
      onBytes: () =>
         new Promise((_resolve, reject) => {
            fail = reject;
         }),
   });
   const rejected = expect(pending).rejects.toThrow("Invalid PCM");
   child.stdout.write(Buffer.from([1]));
   child.emit("close", 0);
   fail(new Error("Invalid PCM"));
   await rejected;
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

it.each([true, false])("rejects failing line consumers and waits for closure, newline %s", async (newline) => {
   const child = childProcess();
   const pending = runMedia("ffprobe", [], {
      onLines: () => {
         throw new Error("Invalid timestamp");
      },
   });
   const rejected = expect(pending).rejects.toThrow("Invalid timestamp");
   child.stdout.write(`timestamp${newline ? "\n" : ""}`);
   expect(child.kill).toHaveBeenCalledTimes(newline ? 1 : 0);
   child.emit("close", 0);
   await rejected;
});

it("reports a missing executable without waiting for close", async () => {
   const child = childProcess();
   Object.assign(child, { pid: undefined });
   const pending = runMedia("ffprobe", []);
   child.emit("error", new Error("spawn ENOENT"));
   await expect(pending).rejects.toThrow("ffprobe was not found");
});
