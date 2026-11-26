import { useEffect, useEffectEvent } from "react";
import type { Bootstrap, ExportJob, RecoveredExport, SourceFileStatus } from "../../../shared/types";

/** One desktop subscription lifetime, with callbacks that read the current editor. */
export function useDesktopLifecycle({
   onBootstrap,
   onJob,
   onOpenFile,
   onSourceFile,
   onRecovered,
   onError,
}: {
   onBootstrap: (data: Bootstrap, signal: AbortSignal) => Promise<void>;
   onJob: (job: ExportJob) => void;
   onOpenFile: (path: string) => void;
   onSourceFile: (status: SourceFileStatus) => void;
   onRecovered: (exports: RecoveredExport[]) => void;
   onError: (error: unknown) => void;
}): void {
   const bootstrap = useEffectEvent(onBootstrap);
   const job = useEffectEvent(onJob);
   const open = useEffectEvent(onOpenFile);
   const file = useEffectEvent(onSourceFile);
   const recovered = useEffectEvent(onRecovered);
   const error = useEffectEvent(onError);
   useEffect(() => {
      const lifetime = new AbortController();
      const unsubscribeJob = window.desktop.onJob((value) => job(value));
      const unsubscribeOpen = window.desktop.onOpenFile((path) => open(path));
      const unsubscribeFile = window.desktop.onSourceFile((status) => file(status));
      void window.desktop
         .bootstrap()
         .then((data) => {
            if (!lifetime.signal.aborted) return bootstrap(data, lifetime.signal);
         })
         .then(() => window.desktop.takeRecoveredExports())
         .then((items) => {
            if (items?.length && !lifetime.signal.aborted) recovered(items);
         })
         .catch((value: unknown) => {
            if (!lifetime.signal.aborted) error(value);
         });
      return () => {
         lifetime.abort();
         unsubscribeJob();
         unsubscribeOpen();
         unsubscribeFile();
      };
   }, []);
}
