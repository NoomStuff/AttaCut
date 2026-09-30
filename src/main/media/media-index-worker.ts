import { parentPort, workerData } from "node:worker_threads";
import { indexedSampleTimes } from "./mp4-sample-table";
import type { ProbedSource } from "./probe";

const result = await indexedSampleTimes(workerData as ProbedSource);
const buffers = result ? [...new Set([result.keyframes.buffer, ...(result.frames ? [result.frames.buffer] : [])])] : [];
parentPort?.postMessage(result, buffers as ArrayBuffer[]);
