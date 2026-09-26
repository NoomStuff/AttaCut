import { useEffect, useRef } from "react";
import type { MediaSource, Preferences, SavedSession } from "../../../shared/types";
import type { EditorState } from "./model";
import { sessionFor } from "./session";
import { errorText } from "../lib/errors";

export function usePersistence({
   source,
   editor,
   restore,
   preferences,
   ready,
   setError,
}: {
   source: MediaSource | null;
   editor: EditorState;
   restore: SavedSession | null;
   preferences: Preferences;
   ready: boolean;
   setError: (message: string) => void;
}): void {
   const latestSnapshot = useRef({ preferences, session: null as SavedSession | null });
   latestSnapshot.current = { preferences, session: sessionFor(source, editor, restore) };
   useEffect(() => {
      const flush = window.desktop.onFlush(() => {
         void window.desktop.flushState(latestSnapshot.current).catch((value: unknown) => setError(errorText(value)));
      });
      return () => {
         flush();
      };
   }, []);
   useEffect(() => {
      if (!ready) return;
      const timer = window.setTimeout(() => {
         void window.desktop.savePreferences(preferences).catch((value: unknown) => setError(errorText(value)));
      }, 100);
      return () => window.clearTimeout(timer);
   }, [preferences, ready]);
   useEffect(() => {
      if (!source) return;
      const timer = window.setTimeout(() => {
         const snapshot = sessionFor(source, editor, null);
         if (snapshot) void window.desktop.saveSession(snapshot).catch((value: unknown) => setError(errorText(value)));
      }, 100);
      return () => window.clearTimeout(timer);
   }, [source, editor]);
}
