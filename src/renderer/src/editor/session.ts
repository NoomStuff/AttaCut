import type { MediaSource, SavedSession } from "../../../shared/types";
import type { EditorState } from "./model";

export function sessionFor(
   source: MediaSource | null,
   editor: EditorState,
   restore: SavedSession | null,
   project?: SavedSession["project"]
): SavedSession | null {
   if (!source) return restore;
   return {
      path: source.path,
      size: source.size,
      modified: source.modified,
      clips: editor.document.clips,
      selectedId: editor.document.selectedId,
      past: editor.past,
      future: editor.future,
      ...(project ? { project } : {}),
   };
}
