type Priority = "interactive" | "export" | "background";
const order: Record<Priority, number> = { interactive: 0, export: 1, background: 2 };
const queued: { priority: Priority; run: () => void }[] = [];
let active = 0;
let background = 0;
let foreground = 0;
const observers = new Set<(busy: boolean) => void>();
function announce(): void {
   const busy = foreground > 0 || queued.some((entry) => entry.priority !== "background");
   for (const observer of observers) observer(busy);
}
/** Optional decoders can stop consuming stdout while seeks or exports need media IO. */
export function observeForegroundMedia(observer: (busy: boolean) => void): () => void {
   observers.add(observer);
   observer(foreground > 0 || queued.some((entry) => entry.priority !== "background"));
   return () => {
      observers.delete(observer);
   };
}

/** Reserve capacity for a seek while exports or preview preparation are running. */
export function scheduleMedia<T>(task: () => Promise<T>, priority: Priority = "interactive", signal?: AbortSignal): Promise<T> {
   return new Promise((resolve, reject) => {
      const entry = {
         priority,
         run: async () => {
            signal?.removeEventListener("abort", abort);
            active++;
            if (priority !== "interactive") background++;
            if (priority !== "background") foreground++;
            announce();
            try {
               resolve(await task());
            } catch (error) {
               reject(error);
            } finally {
               finish();
            }
         },
      };
      const finish = () => {
         active--;
         if (priority !== "interactive") background--;
         if (priority !== "background") foreground--;
         drain();
         announce();
      };
      const abort = () => {
         const index = queued.indexOf(entry);
         if (index >= 0) queued.splice(index, 1);
         signal?.removeEventListener("abort", abort);
         reject(new Error("Cancelled"));
         announce();
      };
      if (signal?.aborted) {
         abort();
         return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      queued.push(entry);
      queued.sort((a, b) => order[a.priority] - order[b.priority]);
      announce();
      drain();
   });
}
function drain(): void {
   while (active < 3) {
      const index = queued.findIndex((entry) => entry.priority === "interactive" || background < 2);
      if (index < 0) return;
      queued.splice(index, 1)[0]!.run();
   }
}
