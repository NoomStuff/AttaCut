import type { Clip } from "../../../shared/types";
import { clamp } from "../../../shared/time";

export interface EditDocument {
   clips: Clip[];
   selectedId: string | null;
}
export interface EditorState {
   document: EditDocument;
   past: EditDocument[];
   future: EditDocument[];
}
export type EditAction =
   { type: "load"; document: EditDocument } | { type: "select"; id: string } | { type: "commit"; document: EditDocument } | { type: "undo" } | { type: "redo" };
export const emptyEditor: EditorState = { document: { clips: [], selectedId: null }, past: [], future: [] };
export function editorReducer(state: EditorState, action: EditAction): EditorState {
   switch (action.type) {
      case "load":
         return { document: action.document, past: [], future: [] };
      case "select":
         return state.document.clips.some((clip) => clip.id === action.id) ? { ...state, document: { ...state.document, selectedId: action.id } } : state;
      case "commit": {
         if (JSON.stringify(state.document.clips) === JSON.stringify(action.document.clips)) return state;
         return { document: action.document, past: [...state.past.slice(-99), state.document], future: [] };
      }
      case "undo": {
         const previous = state.past.at(-1);
         return previous ? { document: previous, past: state.past.slice(0, -1), future: [state.document, ...state.future] } : state;
      }
      case "redo": {
         const next = state.future[0];
         return next ? { document: next, past: [...state.past, state.document], future: state.future.slice(1) } : state;
      }
   }
}
export function newDocument(duration: number): EditDocument {
   const clip = { id: crypto.randomUUID(), start: 0, end: duration, color: 0 };
   return { clips: [clip], selectedId: clip.id };
}
export function selectedClip(document: EditDocument): Clip | undefined {
   return document.clips.find((clip) => clip.id === document.selectedId);
}
/** Smallest edit step across the editor; clock noise below it is invisible. */
export const timeEpsilon = 0.001;
/**
 * Whether a playhead position counts as kept. Boundaries are inclusive within the edit step:
 * dragging a handle or jumping to a boundary pins the clock exactly onto it, and media clocks
 * round positions across the boundary by fractions of a step, so exact comparisons would make
 * boundary UI flicker.
 */
export function insideClip(clips: Clip[], time: number, duration: number): boolean {
   return clips.some(
      (clip) => time >= clip.start - timeEpsilon && (time <= clip.end + timeEpsilon || (clip.end >= duration - timeEpsilon && time <= duration + timeEpsilon))
   );
}
export function canSplit(document: EditDocument, time: number, step = timeEpsilon): boolean {
   const clip = selectedClip(document);
   return !!clip && time >= clip.start + step && time <= clip.end - step;
}
export function splitClip(document: EditDocument, time: number, step = timeEpsilon): EditDocument {
   if (!canSplit(document, time, step)) return document;
   const nextId = crypto.randomUUID();
   const color = Math.max(-1, ...document.clips.map((clip) => clip.color)) + 1;
   return {
      clips: document.clips.flatMap((clip) =>
         clip.id === document.selectedId
            ? [
                 { ...clip, end: time },
                 { ...clip, id: nextId, start: time, color },
              ]
            : [clip]
      ),
      selectedId: nextId,
   };
}
export function trimClip(document: EditDocument, id: string, side: "start" | "end", time: number, duration: number, step = 0.001): EditDocument {
   const index = document.clips.findIndex((clip) => clip.id === id);
   const clip = document.clips[index];
   if (!clip) return document;
   const low = side === "start" ? (document.clips[index - 1]?.end ?? 0) : clip.start + step;
   const high = side === "end" ? (document.clips[index + 1]?.start ?? duration) : clip.end - step;
   const next = { ...clip, [side]: clamp(time, low, high) };
   return { clips: document.clips.map((item) => (item.id === id ? next : item)), selectedId: id };
}
export function deleteClip(document: EditDocument): EditDocument {
   const index = document.clips.findIndex((clip) => clip.id === document.selectedId);
   if (index < 0) return document;
   const clips = document.clips.filter((clip) => clip.id !== document.selectedId);
   return { clips, selectedId: clips[index]?.id ?? clips[index - 1]?.id ?? null };
}
export function gapAt(document: EditDocument, time: number, duration: number): { start: number; end: number } | null {
   if (document.clips.some((clip) => time >= clip.start && time < clip.end)) return null;
   const start = document.clips.filter((clip) => clip.end <= time).at(-1)?.end ?? 0;
   const end = document.clips.find((clip) => clip.start > time)?.start ?? duration;
   return end - start > timeEpsilon ? { start, end } : null;
}
export function addGap(document: EditDocument, time: number, duration: number): EditDocument {
   const gap = gapAt(document, time, duration);
   if (!gap) return document;
   const clip: Clip = { ...gap, id: crypto.randomUUID(), color: Math.max(-1, ...document.clips.map((item) => item.color)) + 1 };
   return { clips: [...document.clips, clip].sort((a, b) => a.start - b.start), selectedId: clip.id };
}
