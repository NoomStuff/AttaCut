import { z } from "zod";
import { legacySessionSchema, storedSessionSchema } from "./session-storage";
import type { SavedSession } from "./editing";

export const projectExtension = "attacut";
/** Three-letter fallback for systems that restrict extensions; spells out AttaCut's initials. */
export const projectFallbackExtension = "atc";
export const projectExtensions = [projectExtension, projectFallbackExtension];
export const isProjectPath = (path: string): boolean => projectExtensions.some((extension) => path.toLowerCase().endsWith(`.${extension}`));
const projectShape = {
   format: z.literal("AttaCut"),
   relativeSource: z.string().min(1).nullable(),
};
export const projectFileSchema = z.union([
   z.object({ ...projectShape, version: z.literal(1), session: legacySessionSchema }),
   z.object({ ...projectShape, version: z.literal(2), session: storedSessionSchema }),
]);
export type ProjectFile = z.infer<typeof projectFileSchema>;

export function projectHasChanges(session: SavedSession): boolean {
   return !!session.project && JSON.stringify(session.clips) !== JSON.stringify(session.project.savedClips);
}

export function discardProjectChanges(session: SavedSession): SavedSession {
   if (!session.project) return session;
   const clips = session.project.savedClips;
   return { ...session, clips, selectedId: clips[0]?.id ?? null, past: [], future: [] };
}
