import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailableUpdate } from "../../../shared/types";
import { errorText } from "./errors";

/**
 * The startup check stays quiet and runs once. Only an explicit check reports that
 * nothing newer was found.
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
   useEffect(() => {
      if (!ready || checkedAtStartup.current) return;
      checkedAtStartup.current = true;
      if (!enabled) return;
      let active = true;
      void window.desktop
         .checkForUpdate()
         .then((value) => {
            if (active) setUpdate(value);
         })
         .catch(() => {});
      return () => {
         active = false;
      };
   }, [ready, enabled]);
   const check = useCallback(() => {
      void window.desktop
         .checkForUpdate()
         .then((value) => {
            setUpdate(value);
            if (!value) onLatest();
         })
         .catch((value: unknown) => onError(errorText(value)));
   }, [onLatest, onError]);
   return { update, check };
}
