import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { probeSource } from "./media/probe";
import type { ProbedSource } from "./media/probe";

/** Only editor opens reuse metadata. Export verification always probes its input again. */
export class SourceProbe {
   private readonly cached = new Map<string, { identity: string; source: ProbedSource }>();

   async open(path: string, signal?: AbortSignal): Promise<ProbedSource> {
      signal?.throwIfAborted();
      const fullPath = resolve(path);
      const info = await stat(fullPath);
      signal?.throwIfAborted();
      const identity = JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.birthtimeMs]);
      const cached = this.cached.get(fullPath);
      this.cached.delete(fullPath);
      if (info.isFile() && cached?.identity === identity) {
         this.cached.set(fullPath, cached);
         const source = structuredClone(cached.source);
         source.id = randomUUID();
         source.url = `media://source/${source.id}`;
         return source;
      }
      const source = await probeSource(fullPath, signal);
      signal?.throwIfAborted();
      // A file may change while ffprobe reads it. Such a result must never enter the cache.
      const after = await stat(fullPath);
      signal?.throwIfAborted();
      if (identity === JSON.stringify([after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs, after.birthtimeMs])) {
         this.cached.set(fullPath, { identity, source: structuredClone(source) });
         while (this.cached.size > 4) this.cached.delete(this.cached.keys().next().value!);
      }
      return source;
   }
}
