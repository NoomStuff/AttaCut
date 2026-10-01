import { z } from "zod";
import { undoLimit } from "./defaults";
export const clipSchema = z
   .object({
      id: z.string().min(1),
      start: z.number().finite().nonnegative(),
      end: z.number().finite().positive(),
      color: z.number().int().nonnegative(),
   })
   .refine((clip) => clip.end > clip.start, "A clip must have a positive duration.");
export type Clip = z.infer<typeof clipSchema>;

const savedDocumentShape = {
   clips: z.array(clipSchema).max(500),
   selectedId: z.string().nullable(),
};
const savedDocumentInvariant = (document: { clips: Clip[]; selectedId: string | null }): boolean =>
   new Set(document.clips.map((clip) => clip.id)).size === document.clips.length &&
   document.clips.every((clip, index) => index === 0 || clip.start >= document.clips[index - 1]!.end) &&
   (document.selectedId === null || document.clips.some((clip) => clip.id === document.selectedId));
export const savedDocumentSchema = z.object(savedDocumentShape).refine(savedDocumentInvariant, "Saved clips are inconsistent.");
export type SavedDocument = z.infer<typeof savedDocumentSchema>;
export const savedSessionSchema = z
   .object({
      path: z.string(),
      size: z.number(),
      modified: z.number(),
      ...savedDocumentShape,
      past: z.array(savedDocumentSchema).max(undoLimit).default([]),
      future: z.array(savedDocumentSchema).max(undoLimit).default([]),
      project: z
         .object({
            path: z.string().min(1),
            savedClips: z
               .array(clipSchema)
               .max(500)
               .refine((clips) => savedDocumentInvariant({ clips, selectedId: null }), "Saved project clips are inconsistent."),
         })
         .optional(),
   })
   .refine(savedDocumentInvariant, "Saved clips are inconsistent.");
export type SavedSession = z.infer<typeof savedSessionSchema>;
