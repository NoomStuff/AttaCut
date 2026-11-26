import type { RendererError } from "../../../shared/bug-report";

/** A render loop can throw every frame; the log keeps the first few and says when it stops. */
const limit = 40;
const repeatWindowMs = 10_000;

export function createErrorReporter(send: (error: RendererError) => Promise<void>, now: () => number = Date.now) {
   let sent = 0;
   const recent = new Map<string, number>();
   return (kind: RendererError["kind"], value: unknown, source?: string) => {
      if (sent >= limit) return;
      const error = value instanceof Error ? value : null;
      const message = (error?.message ?? (typeof value === "string" ? value : safeString(value))).slice(0, 4000);
      const key = `${kind}:${message}`;
      const at = now();
      const last = recent.get(key);
      recent.set(key, at);
      if (last !== undefined && at - last < repeatWindowMs) return;
      sent++;
      const report: RendererError = {
         kind,
         message: sent === limit ? `${message} (further renderer errors are not logged this session)` : message,
         ...(error?.stack ? { stack: error.stack.slice(0, 16_000) } : {}),
         ...(source ? { source: source.slice(0, 16_000) } : {}),
      };
      // Reporting must never raise another error.
      void send(report).catch(() => undefined);
   };
}

function safeString(value: unknown): string {
   try {
      return typeof value === "object" ? JSON.stringify(value) : String(value);
   } catch {
      return Object.prototype.toString.call(value);
   }
}
