type Priority = "interactive" | "export" | "background";
const order: Record<Priority, number> = { interactive: 0, export: 1, background: 2 };
const queued: { priority: Priority; run: () => void }[] = [];
let active = 0;
let background = 0;

/** Reserve capacity for a seek while exports or preview preparation are running. */
export function scheduleMedia<T>(task: () => Promise<T>, priority: Priority = "interactive", signal?: AbortSignal): Promise<T> {
   return new Promise((resolve, reject) => {
      const entry = {
         priority,
         run: async () => {
            signal?.removeEventListener("abort", abort);
            active++;
            if (priority !== "interactive") background++;
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
         drain();
      };
      const abort = () => {
         const index = queued.indexOf(entry);
         if (index >= 0) queued.splice(index, 1);
         signal?.removeEventListener("abort", abort);
         reject(new Error("Cancelled"));
      };
      if (signal?.aborted) {
         abort();
         return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      queued.push(entry);
      queued.sort((a, b) => order[a.priority] - order[b.priority]);
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
