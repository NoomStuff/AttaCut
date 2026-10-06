import { z } from "zod";
import { clipSchema, savedSessionSchema, savedSessionSnapshotSchema } from "./editing";
import { clipLimit, undoLimit } from "./defaults";
import { decodeSession } from "./session-codec";

const deltaSchema = z.object({
   remove: z.array(z.string().min(1)).max(clipLimit),
   set: z.array(clipSchema).max(clipLimit),
   selectedId: z.string().nullable(),
});
export const storedSessionSchema = savedSessionSnapshotSchema
   .safeExtend({
      history: z.object({ version: z.literal(1), past: z.array(deltaSchema).max(undoLimit), future: z.array(deltaSchema).max(undoLimit) }),
   })
   .transform((session, context) => {
      try {
         return decodeSession(session);
      } catch (error) {
         context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Saved history is invalid." });
         return z.NEVER;
      }
   });
// An invalid or unknown compact history must never fall back to a history-free legacy save.
export const legacySessionSchema = savedSessionSchema.safeExtend({ history: z.never().optional() });
export const sessionStorageSchema = z.union([storedSessionSchema, legacySessionSchema]);
