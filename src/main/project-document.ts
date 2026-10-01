import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { projectFileSchema } from "../shared/project";
import type { ProjectFile } from "../shared/project";
import type { MediaSource, SavedSession } from "../shared/types";
import { protectSource, publishOutput } from "./media/publish";
import { withTemporaryOutput } from "./media/transaction";

export async function readProject(path: string): Promise<ProjectFile> {
   if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error("This project file is too large to open.");
   const text = await readFile(path, "utf8");
   let value: unknown;
   try {
      value = JSON.parse(text);
   } catch {
      throw new Error("This project file is damaged or incomplete.");
   }
   if (typeof value === "object" && value !== null && "format" in value && value.format === "AttaCut" && "version" in value && value.version !== 1)
      throw new Error("This project was saved with a different project format. Update AttaCut to open it.");
   const result = projectFileSchema.safeParse(value);
   if (!result.success) throw new Error("This file is not a valid AttaCut project.");
   return result.data;
}

export function projectSourcePaths(path: string, project: ProjectFile): string[] {
   return [
      ...new Set([
         ...(project.relativeSource && !isAbsolute(project.relativeSource) ? [resolve(dirname(path), project.relativeSource)] : []),
         ...(isAbsolute(project.session.path) ? [project.session.path] : []),
      ]),
   ];
}

export function validateProjectSource(session: SavedSession, source: Pick<MediaSource, "size" | "modified"> & { duration?: number }): void {
   if (session.size !== source.size || session.modified !== source.modified)
      throw new Error("The original video has changed. Locate the unchanged original to open this project with its saved clips.");
   const duration = source.duration;
   if (duration !== undefined && [session, ...session.past, ...session.future].some((document) => document.clips.some((clip) => clip.end > duration)))
      throw new Error("This project's clips extend past the end of the video. The saved clips were kept in the project file.");
}

export async function writeProject(path: string, session: SavedSession): Promise<SavedSession> {
   const saved = { ...session };
   delete saved.project;
   const sourceRelative = relative(dirname(path), session.path);
   const document: ProjectFile = {
      format: "AttaCut",
      version: 1,
      relativeSource: sourceRelative && !isAbsolute(sourceRelative) ? sourceRelative.replaceAll("\\", "/") : null,
      session: saved,
   };
   projectFileSchema.parse(document);
   const normalize = (value: string) => (process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value));
   if (normalize(path) === normalize(session.path)) throw new Error("A project file cannot replace the source video. Choose a different filename.");
   await protectSource(session.path, path);
   await withTemporaryOutput(dirname(path), ".attacut-project-", async (directory) => {
      const temporary = join(directory, "project.json");
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`);
      await publishOutput(temporary, path, true, session.path);
   });
   return { ...session, project: { path: resolve(path), savedClips: session.clips } };
}

export async function updateProjectSource(path: string, project: ProjectFile, sourcePath: string): Promise<void> {
   const sourceRelative = relative(dirname(path), sourcePath);
   const relativeSource = sourceRelative && !isAbsolute(sourceRelative) ? sourceRelative.replaceAll("\\", "/") : null;
   if (project.session.path !== sourcePath || project.relativeSource !== relativeSource) await writeProject(path, { ...project.session, path: sourcePath });
}
