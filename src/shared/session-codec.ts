import type { Clip, SavedDocument, SavedSession } from "./editing";
import { clipLimit } from "./defaults";

export interface ClipDelta {
   remove: string[];
   set: Clip[];
   selectedId: string | null;
}
export type StoredSession = Omit<SavedSession, "past" | "future"> & {
   history: { version: 1; past: ClipDelta[]; future: ClipDelta[] };
};
export type SessionInput = SavedSession | StoredSession;

function checkDocument(document: SavedDocument): void {
   if (
      document.clips.length > clipLimit ||
      new Set(document.clips.map((clip) => clip.id)).size !== document.clips.length ||
      document.clips.some((clip, index) => index > 0 && clip.start < document.clips[index - 1]!.end) ||
      (document.selectedId !== null && !document.clips.some((clip) => clip.id === document.selectedId))
   )
      throw new Error("Saved history contains inconsistent clips.");
}

function difference(from: SavedDocument, to: SavedDocument): ClipDelta {
   checkDocument(to);
   const before = new Map(from.clips.map((clip) => [clip.id, clip]));
   const after = new Set(to.clips.map((clip) => clip.id));
   return {
      remove: from.clips.filter((clip) => !after.has(clip.id)).map((clip) => clip.id),
      set: to.clips.filter((clip) => {
         const previous = before.get(clip.id);
         return !previous || previous.start !== clip.start || previous.end !== clip.end || previous.color !== clip.color;
      }),
      selectedId: to.selectedId,
   };
}

/** Each branch starts at the current timeline and walks outward, one edit at a time. */
export function encodeSession(session: SessionInput): StoredSession {
   if ("history" in session) return session;
   checkDocument(session);
   const encode = (documents: SavedDocument[]) => {
      let previous: SavedDocument = session;
      return documents.map((document) => {
         const delta = difference(previous, document);
         previous = document;
         return delta;
      });
   };
   const { past, future, ...current } = session;
   return { ...current, history: { version: 1, past: encode(past.toReversed()), future: encode(future) } };
}

/** Validated deltas reuse unchanged clips when reconstructing the editor's undo states. */
export function decodeSession(session: StoredSession): SavedSession {
   const decode = (deltas: ClipDelta[]) => {
      let previous: SavedDocument = session;
      return deltas.map((delta) => {
         const clips = new Map(previous.clips.map((clip) => [clip.id, clip]));
         const removed = new Set(delta.remove);
         if (removed.size !== delta.remove.length || new Set(delta.set.map((clip) => clip.id)).size !== delta.set.length)
            throw new Error("Saved history repeats a clip change.");
         for (const id of removed) if (!clips.delete(id)) throw new Error("Saved history removes a missing clip.");
         for (const clip of delta.set) {
            if (removed.has(clip.id)) throw new Error("Saved history both removes and changes a clip.");
            clips.set(clip.id, clip);
         }
         const document = { clips: [...clips.values()].sort((a, b) => a.start - b.start), selectedId: delta.selectedId };
         checkDocument(document);
         previous = document;
         return document;
      });
   };
   const { history, ...current } = session;
   return { ...current, past: decode(history.past).reverse(), future: decode(history.future) };
}
