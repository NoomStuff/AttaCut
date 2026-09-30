import { mkdtemp, writeFile, stat, link, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { diagnosticReport, recordDiagnostic, recordAssessment, protectDiagnosticDestination } from "./diagnostics";
import type { ProbedSource } from "./media/probe";
import type { ExportJob, CutReport } from "../shared/export";

it("retains bounded timings and capabilities without source names, edit positions or raw errors", () => {
   const source = {
      id: "private-source-id",
      path: "C:/private/recording.mp4",
      name: "private-title",
      extension: ".mp4",
      streams: [{ type: "video", codec: "h264", title: "private-track-title", width: 1920, height: 1080, frameRate: 30 }],
   } as unknown as ProbedSource;
   const reports = [
      {
         method: "boundary",
         encodedSeconds: 1,
         clip: { id: "private-clip", start: 100, end: 200 },
         message: "private-error",
         streams: [{ index: 0, type: "video", action: "copy", reason: "private-reason" }],
      },
   ] as CutReport[];
   const job = {
      id: "private-job",
      sourceId: source.id,
      directory: "C:/private/export",
      running: false,
      items: [
         {
            id: "private-item",
            name: "private-file",
            outputPath: "C:/private/clip.mp4",
            status: "failed",
            stage: "checking",
            failure: { code: "disk-full", detail: "private-log", message: "private-message" },
         },
      ],
   } as unknown as ExportJob;
   recordAssessment(source.id, reports);
   for (let index = 0; index < 250; index++) recordDiagnostic("ffmpeg", index, "disk-full");
   const report = diagnosticReport("1.2.3", { ffmpeg: "ffmpeg version fixture" }, source, job);
   expect(JSON.stringify(report)).not.toContain("private");
   expect(report.operations).toHaveLength(200);
   expect(report.operations[0]?.elapsedMs).toBe(50);
   expect(report.assessment?.[0]).toMatchObject({ method: "boundary", encodingNeeded: true, streams: [{ type: "video", action: "copy" }] });
   expect(diagnosticReport("1.2.3", {}, { ...source, id: "different-source" }, null).assessment).toBeNull();
});
it("protects source paths and surviving hard links while allowing diagnostics for a missing source", async () => {
   const directory = await mkdtemp(join(tmpdir(), "attacut-diagnostics-"));
   try {
      const path = join(directory, "source.mp4");
      const alias = join(directory, "alias.json");
      await writeFile(path, "original");
      await link(path, alias);
      const info = await stat(path);
      const source = { path, fileIdentity: { device: info.dev, inode: info.ino } } as ProbedSource;
      await expect(protectDiagnosticDestination(path, [source])).rejects.toThrow("cannot replace");
      await expect(protectDiagnosticDestination(alias, [source])).rejects.toThrow("linked");
      await rm(path);
      await expect(protectDiagnosticDestination(alias, [source])).rejects.toThrow("linked");
      await expect(protectDiagnosticDestination(join(directory, "report.json"), [source])).resolves.toBeUndefined();
      const folder = join(directory, "folder.json");
      await mkdir(folder);
      await expect(protectDiagnosticDestination(folder, [source])).rejects.toThrow("Choose a file");
   } finally {
      await rm(directory, { recursive: true, force: true });
   }
});
