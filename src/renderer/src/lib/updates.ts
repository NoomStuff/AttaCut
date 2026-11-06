import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailableUpdate } from "../../../shared/types";
import { errorText } from "./errors";

/** Long sessions keep looking for releases without asking the user to restart first. */
export const updateRecheckMs = 4 * 60 * 60 * 1000;

/**
 * Automatic checks stay quiet: once at startup, then every few hours. Only an explicit
 * check reports that nothing newer was found. A previous restart that did not install its
 * update is reported first, and that version is not retried automatically.
 */
export function useUpdates({
   ready,
   enabled,
   onLatest,
   onError,
}: {
   ready: boolean;
   enabled: boolean;
   onLatest: () => void;
   onError: (message: string) => void;
}) {
   const [update, setUpdate] = useState<AvailableUpdate | null>(null);
   const checkedAtStartup = useRef(false);
   const failedVersion = useRef<string | null>(null);
   const offer = useCallback((value: AvailableUpdate | null) => {
      if (value && value.version === failedVersion.current) return;
      if (value) failedVersion.current = null;
      setUpdate((current) => (current?.notApplied && !value ? current : value));
   }, []);
   useEffect(() => {
      if (!ready || checkedAtStartup.current) return;
      checkedAtStartup.current = true;
      let active = true;
      void (async () => {
         const failed = await window.desktop.takeUpdateOutcome().catch(() => null);
         if (!active) return;
         // Any check would download that version again; leave retrying to the user.
         if (failed) {
            failedVersion.current = failed.version;
            setUpdate(failed);
            return;
         }
         if (!enabled) return;
         const value = await window.desktop.checkForUpdate().catch(() => null);
         if (active) offer(value);
      })();
      return () => {
         active = false;
      };
   }, [ready, enabled, offer]);
   useEffect(() => {
      if (!ready || !enabled) return;
      const timer = window.setInterval(() => {
         if (failedVersion.current) return;
         void window.desktop
            .checkForUpdate()
            .then(offer)
            .catch(() => {});
      }, updateRecheckMs);
      return () => window.clearInterval(timer);
   }, [ready, enabled, offer]);
   const check = useCallback(() => {
      void window.desktop
         .checkForUpdate()
         .then((value) => {
            // An explicit check may retry a version that did not apply.
            failedVersion.current = null;
            setUpdate(value);
            if (!value) onLatest();
         })
         .catch((value: unknown) => onError(errorText(value)));
   }, [onLatest, onError]);
   return { update, check };
}
