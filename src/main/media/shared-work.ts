/** A caller may stop waiting without cancelling work other callers still need. */
export function waitForWork<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
   if (!signal) return work;
   if (signal.aborted) return Promise.reject(signal.reason);
   return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
   });
}
