import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { MediaSource, Preferences, SavedSession } from "../../../shared/types";
import type { EditorState } from "./model";
import { sessionFor } from "./session";
import { errorText } from "../lib/errors";

export function usePersistence({
   source,
   editor,
   restore,
   project,
   pendingProjectSave,
   preferences,
   ready,
   setError,
}: {
   source: MediaSource | null;
   editor: EditorState;
   restore: SavedSession | null;
   project: SavedSession["project"];
   pendingProjectSave: RefObject<Promise<boolean> | null>;
   preferences: Preferences;
   ready: boolean;
   setError: (message: string) => void;
}): void {
   const latestSnapshot = useRef({ preferences, session: null as SavedSession | null });
   latestSnapshot.current = { preferences, session: sessionFor(source, editor, restore, project) };
   useEffect(() => {
      const flush = window.desktop.onFlush(() => {
         window.desktop.flushStarted();
         void (async () => {
            const pending = pendingProjectSave.current;
            const saved = await pending;
            await window.desktop.flushState({
               ...latestSnapshot.current,
               closing: !!latestSnapshot.current.session?.project,
               cancelClose: !!pending && !saved,
            });
         })().catch((value: unknown) => setError(errorText(value)));
      });
      return () => {
         flush();
      };
   }, [pendingProjectSave, setError]);
   useEffect(() => {
      if (!ready) return;
      const timer = window.setTimeout(() => {
         void window.desktop.savePreferences(preferences).catch((value: unknown) => setError(errorText(value)));
      }, 100);
      return () => window.clearTimeout(timer);
   }, [preferences, ready, setError]);
   useEffect(() => {
      if (!source) return;
      const timer = window.setTimeout(() => {
         const snapshot = sessionFor(source, editor, null, project);
         if (snapshot) void window.desktop.saveSession(snapshot).catch((value: unknown) => setError(errorText(value)));
      }, 500);
      return () => window.clearTimeout(timer);
   }, [source, editor, project, setError]);
}
