import { useEffect, useState } from "react";
import type { RecentEntry } from "../../../shared/recent";

/** Recent files from the main process, which records an entry whenever a file opens. */
export function useRecentFiles(): RecentEntry[] {
   const [recent, setRecent] = useState<RecentEntry[]>([]);
   useEffect(() => {
      let current = true;
      const refresh = () => {
         window.desktop
            .recentFiles()
            .then((entries) => {
               if (current) setRecent(entries);
            })
            // History is a convenience; a failed read leaves the previous list.
            .catch(() => undefined);
      };
      refresh();
      const unsubscribe = window.desktop.onRecentFilesChanged(refresh);
      return () => {
         current = false;
         unsubscribe();
      };
   }, []);
   return recent;
}
