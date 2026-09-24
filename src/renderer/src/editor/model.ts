import type { Clip } from "../../../shared/types";
import { clipColorCount, undoLimit } from "../../../shared/defaults";
import { clamp } from "../../../shared/time";
import { nextClipColor } from "./colors";

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
   | { type: "load"; document: EditDocument; past?: EditDocument[]; future?: EditDocument[] }
   | { type: "commit"; document: EditDocument }
   | { type: "undo" }
   | { type: "redo" };
export const emptyEditor: EditorState = { document: { clips: [], selectedId: null }, past: [], future: [] };
export function editorReducer(state: EditorState, action: EditAction): EditorState {
   switch (action.type) {
      case "load":
         return {
            document: action.document,
            past: action.past ?? [],
            future: action.future ?? [],
         };
      case "commit": {
         if (JSON.stringify(state.document.clips) === JSON.stringify(action.document.clips)) return state;
         return {
            document: action.document,
            past: [...state.past, state.document].slice(-undoLimit),
            future: [],
         };
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
 * Floor for clip edits: never shorter than two frames, and never narrower than a sliver of the
 * current timeline view so zooming in restores fine precision.
 */
export function minClipLength(viewLength: number, frameStep: number): number {
   return Math.max(frameStep * 2, viewLength * 0.015);
}
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
/**
 * Structural edits name their target clip explicitly. The document's selectedId only records
 * the last edit for persistence; which clip a command operates on is resolved by the caller
 * from the playhead, never re-derived inside these functions.
 */
export function canSplit(document: EditDocument, id: string, time: number, step = timeEpsilon): boolean {
   const clip = document.clips.find((item) => item.id === id);
   return !!clip && time >= clip.start + step && time <= clip.end - step;
}
export function splitClip(document: EditDocument, id: string, time: number, step = timeEpsilon): EditDocument {
   if (!canSplit(document, id, time, step)) return document;
   const index = document.clips.findIndex((clip) => clip.id === id);
   const nextId = crypto.randomUUID();
   const color = nextClipColor(document.clips, document.clips[index], document.clips[index + 1]);
   return {
      clips: document.clips.flatMap((clip) =>
         clip.id === id
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
export function deleteClip(document: EditDocument, id: string): EditDocument {
   const index = document.clips.findIndex((clip) => clip.id === id);
   if (index < 0) return document;
   const clips = document.clips.filter((clip) => clip.id !== id);
   return { clips, selectedId: clips[index]?.id ?? clips[index - 1]?.id ?? null };
}
export function gapAt(document: EditDocument, time: number, duration: number): { start: number; end: number } | null {
   let start = 0;
   for (const clip of document.clips) {
      if (clip.start - start > timeEpsilon && time >= start - timeEpsilon && time <= clip.start + timeEpsilon) return { start, end: clip.start };
      start = clip.end;
   }
   return duration - start > timeEpsilon && time >= start - timeEpsilon && time <= duration + timeEpsilon ? { start, end: duration } : null;
}
export function addGap(document: EditDocument, time: number, duration: number): EditDocument {
   const gap = gapAt(document, time, duration);
   if (!gap) return document;
   const index = document.clips.findIndex((clip) => clip.start >= gap.end);
   const insertion = index < 0 ? document.clips.length : index;
   const clip: Clip = {
      ...gap,
      id: crypto.randomUUID(),
      color: nextClipColor(document.clips, document.clips[insertion - 1], document.clips[insertion]),
   };
   const clips = [...document.clips];
   clips.splice(insertion, 0, clip);
   return { clips, selectedId: clip.id };
}

/** Find the nearest join, allowing at most one source frame between clips. */
export function mergePair(document: EditDocument, time: number, frameStep: number, handleTolerance: number): number {
   let found = -1;
   let distance = Infinity;
   document.clips.slice(0, -1).forEach((left, index) => {
      const right = document.clips[index + 1]!;
      const gap = right.start - left.end;
      const delta = Math.abs(time - (left.end + right.start) / 2);
      if (gap >= 0 && gap <= frameStep + timeEpsilon && delta <= handleTolerance && delta < distance) {
         found = index;
         distance = delta;
      }
   });
   return found;
}
export function mergeClips(document: EditDocument, index: number): EditDocument {
   const left = document.clips[index];
   const right = document.clips[index + 1];
   if (index < 0 || !left || !right) return document;
   const previous = document.clips[index - 1];
   const next = document.clips[index + 2];
   const collision = [previous, next].some((clip) => clip && clip.color % clipColorCount === left.color % clipColorCount);
   const color = collision ? nextClipColor(document.clips, previous, next) : left.color;
   return {
      clips: document.clips.flatMap((clip, i) => (i === index ? [{ ...left, end: right.end, color }] : i === index + 1 ? [] : [clip])),
      selectedId: left.id,
   };
}

/** Interaction memory is independent of selection and survives deletion until the next move/edit. */
export class ClipPriority {
   private last: Clip | undefined;
   remember(clip: Clip | undefined): void {
      this.last = clip;
   }
   resolve(document: EditDocument, time: number, includeDeleted = true): Clip | undefined {
      const contains = (clip: Clip) => time >= clip.start - timeEpsilon && time <= clip.end + timeEpsilon;
      const interior = document.clips.find((clip) => time > clip.start + timeEpsilon && time < clip.end - timeEpsilon);
      if (interior) return interior;
      const remembered = document.clips.find((clip) => clip.id === this.last?.id) ?? (includeDeleted ? this.last : undefined);
      if (remembered && contains(remembered)) return remembered;
      return document.clips.find(contains);
   }
   move(document: EditDocument, time: number): void {
      const candidates = document.clips.filter((clip) => time >= clip.start - timeEpsilon && time <= clip.end + timeEpsilon);
      // A clear gap starts a fresh interaction. At an edge, preserve the previous choice.
      if (!candidates.length) this.last = undefined;
      else this.last = this.resolve(document, time);
   }
}
