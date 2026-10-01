import { z } from "zod";
import { savedSessionSchema } from "./editing";
import type { SavedSession } from "./editing";

export const projectExtension = "attacut";
/** Three-letter fallback for systems that restrict extensions; spells out AttaCut's initials. */
export const projectFallbackExtension = "atc";
export const projectExtensions = [projectExtension, projectFallbackExtension];
export const isProjectPath = (path: string): boolean => projectExtensions.some((extension) => path.toLowerCase().endsWith(`.${extension}`));
export const projectFileSchema = z.object({
   format: z.literal("AttaCut"),
   version: z.literal(1),
   relativeSource: z.string().min(1).nullable(),
   session: savedSessionSchema,
});
export type ProjectFile = z.infer<typeof projectFileSchema>;

export function projectHasChanges(session: SavedSession): boolean {
   return !!session.project && JSON.stringify(session.clips) !== JSON.stringify(session.project.savedClips);
}

export function discardProjectChanges(session: SavedSession): SavedSession {
   if (!session.project) return session;
   const clips = session.project.savedClips;
   return { ...session, clips, selectedId: clips[0]?.id ?? null, past: [], future: [] };
}
