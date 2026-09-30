import { useEffect, useEffectEvent } from "react";
import type { Bootstrap, ExportJob } from "../../../shared/types";

/** One desktop subscription lifetime, with callbacks that read the current editor. */
export function useDesktopLifecycle({
   onBootstrap,
   onJob,
   onOpenFile,
   onError,
}: {
   onBootstrap: (data: Bootstrap, signal: AbortSignal) => Promise<void>;
   onJob: (job: ExportJob) => void;
   onOpenFile: (path: string) => void;
   onError: (error: unknown) => void;
}): void {
   const bootstrap = useEffectEvent(onBootstrap);
   const job = useEffectEvent(onJob);
   const open = useEffectEvent(onOpenFile);
   const error = useEffectEvent(onError);
   useEffect(() => {
      const lifetime = new AbortController();
      const unsubscribeJob = window.desktop.onJob((value) => job(value));
      const unsubscribeOpen = window.desktop.onOpenFile((path) => open(path));
      void window.desktop
         .bootstrap()
         .then((data) => {
            if (!lifetime.signal.aborted) return bootstrap(data, lifetime.signal);
         })
         .catch((value: unknown) => {
            if (!lifetime.signal.aborted) error(value);
         });
      return () => {
         lifetime.abort();
         unsubscribeJob();
         unsubscribeOpen();
      };
   }, []);
}
