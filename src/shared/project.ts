import type { SavedSession } from "./editing";

export const projectExtension = "attacut";
/** Three-letter fallback for systems that restrict extensions; spells out AttaCut's initials. */
export const projectFallbackExtension = "atc";
export const projectExtensions = [projectExtension, projectFallbackExtension];
export const isProjectPath = (path: string): boolean => projectExtensions.some((extension) => path.toLowerCase().endsWith(`.${extension}`));
export function projectHasChanges(session: SavedSession): boolean {
   if (!session.project) return false;
   const saved = session.project.savedClips;
   return (
      session.clips.length !== saved.length ||
      session.clips.some((clip, index) => {
         const previous = saved[index]!;
         return clip.id !== previous.id || clip.start !== previous.start || clip.end !== previous.end || clip.color !== previous.color;
      })
   );
}

export function discardProjectChanges(session: SavedSession): SavedSession {
   if (!session.project) return session;
   const clips = session.project.savedClips;
   return { ...session, clips, selectedId: clips[0]?.id ?? null, past: [], future: [] };
}
