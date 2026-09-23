/** Let the current interaction paint before starting optional background work. */
export function afterIdle(task: () => void, delay = 750): () => void {
   let idle = 0;
   const timer = window.setTimeout(() => {
      idle = window.requestIdleCallback(task);
   }, delay);
   return () => {
      window.clearTimeout(timer);
      window.cancelIdleCallback(idle);
   };
}

/** Load one module per idle period so prefetching does not create one long startup task. */
export function prefetchModules(loaders: (() => Promise<unknown>)[]): () => void {
   let cancelled = false;
   let cancelIdle = () => {};
   const next = (index: number) => {
      const load = loaders[index];
      if (cancelled || !load) return;
      cancelIdle = afterIdle(
         () => {
            void load()
               .catch(() => undefined)
               .then(() => next(index + 1));
         },
         index === 0 ? 750 : 0
      );
   };
   next(0);
   return () => {
      cancelled = true;
      cancelIdle();
   };
}
