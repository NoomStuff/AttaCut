import { useEffect, useState } from "react";
import type { AvailableUpdate, UpdateStatus } from "../../../shared/types";
import { errorText } from "../lib/errors";
import { UpdateChip } from "./UpdateChip";

/** Update availability, download events and actions have one owner. Availability comes from
    App so the Help menu's "Check for updates" and the chip share one result. */
export function AppUpdate({ update, onError }: { update: AvailableUpdate | null; onError: (message: string) => void }) {
   const [status, setStatus] = useState<UpdateStatus | null>(null);
   useEffect(() => window.desktop.onUpdateStatus(setStatus), []);
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
