import { z } from "zod";
import { preferencesSchema } from "./preferences";
import { sessionStorageSchema } from "./session-storage";
import { frameRequestSchema, frameTimeRequestSchema, scrubRequestSchema, previewRequestSchema, waveformRequestSchema } from "./media-requests";
import { planRequestSchema, analyzeRequestSchema, exportApprovalSchema } from "./export";

/** The main-process boundary validates these once before invoking a typed route. */
export const ipcRequestSchemas = {
   "app:bootstrap": z.void(),
   "update:check": z.void(),
   "update:download": z.string(),
   "update:restart": z.void(),
   "source:choose": z.void(),
   "source:open": z.string().min(1),
   "project:open": z.string().min(1),
   "project:save": z.object({ session: sessionStorageSchema, saveAs: z.boolean() }),
   "project:confirm": sessionStorageSchema,
   "source:close": z.void(),
   "source:keyframes": z.string(),
   "source:frame-time": frameTimeRequestSchema,
   "directory:choose": z.string(),
   "preferences:save": preferencesSchema,
   "session:save": sessionStorageSchema,
   "state:flush": z.object({
      preferences: preferencesSchema,
      session: sessionStorageSchema.nullable(),
      closing: z.boolean().optional(),
      cancelClose: z.boolean().optional(),
   }),
   "app:factory-reset": z.void(),
   "window:title": z.string(),
   "preview:prepare": previewRequestSchema,
   "preview:cancel": z.void(),
   "audio:scrub": scrubRequestSchema,
   "audio:cancel": z.void(),
   "waveform:start": waveformRequestSchema,
   "waveform:cancel": z.void(),
   "frame:export": frameRequestSchema,
   "export:plan": planRequestSchema,
   "export:check-destinations": planRequestSchema,
   "export:analyze": analyzeRequestSchema,
   "export:cancel-planning": z.void(),
   "export:cancel-analysis": z.void(),
   "export:start": z.object({ id: z.string(), approval: exportApprovalSchema.optional() }),
   "export:cancel": z.void(),
   "export:retry": z.string(),
   "output:open": z.string(),
   "output:reveal": z.string(),
   "open:external": z.string(),
   "notices:open": z.void(),
   "diagnostics:export": z.void(),
};
