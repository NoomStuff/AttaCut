import { useEffect, useState } from "react";
import type { AvailableUpdate, UpdateStatus } from "../../../shared/types";
import { errorText } from "../lib/errors";
import { UpdateChip } from "./UpdateChip";

/** Update availability, download events and actions have one owner. */
export function AppUpdate({ ready, onError }: { ready: boolean; onError: (message: string) => void }) {
   const [update, setUpdate] = useState<AvailableUpdate | null>(null);
   const [status, setStatus] = useState<UpdateStatus | null>(null);
   useEffect(() => window.desktop.onUpdateStatus(setStatus), []);
   useEffect(() => {
      if (!ready) return;
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
   }, [ready]);
   if (!update) return null;
   const failure = (value: unknown) => setStatus({ phase: "error", version: update.version, percent: null, message: errorText(value) });
   return (
      <UpdateChip
         update={update}
         status={status}
         onDownload={() => {
            setStatus({ phase: "downloading", version: update.version, percent: null });
            void window.desktop.downloadUpdate(update.version).catch(failure);
         }}
         onRestart={() => {
            void window.desktop.restartToUpdate().catch(failure);
         }}
         onRelease={() => {
            void window.desktop.openExternal(update.url).catch((value) => onError(errorText(value)));
         }}
         onReveal={() => {
            if (status?.path) void window.desktop.revealOutput(status.path).catch((value) => onError(errorText(value)));
         }}
      />
   );
}
