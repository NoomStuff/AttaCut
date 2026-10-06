import type { EditDocument } from "./model";

/** Share Timeline drag drafts with Transport without rendering App on each pointer move. */
export function createDraftStore() {
   let draft: EditDocument | null = null;
   const listeners = new Set<() => void>();
   return {
      get: () => draft,
      set: (next: EditDocument | null) => {
         if (next === draft) return;
         draft = next;
         listeners.forEach((listener) => listener());
      },
      subscribe: (listener: () => void) => {
         listeners.add(listener);
         return () => {
            listeners.delete(listener);
         };
      },
   };
}
export type DraftStore = ReturnType<typeof createDraftStore>;
