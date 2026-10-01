interface Rule {
   before?: string;
   after?: string;
   patch?: Record<string, unknown>;
   unsupportedAudio?: boolean;
   rememberUrl?: boolean;
   previewSuffix?: string;
}

/** Development-only fault injection at our registration boundary, never Electron internals. */
export class IpcTestAdapter {
   private rules = new Map<string, Rule>();
   private gates = new Map<string, Set<() => void>>();
   private calls = new Map<string, number>();
   private completed = new Set<string>();
   private sourceUrl = "";
   configure(channel: string, rule: Rule): void {
      this.rules.set(channel, rule);
   }
   waiting(name: string): boolean {
      return this.gates.has(name);
   }
   release(name: string): void {
      for (const release of this.gates.get(name) ?? []) release();
      this.gates.delete(name);
   }
   count(channel: string): number {
      return this.calls.get(channel) ?? 0;
   }
   ready(channel: string): boolean {
      return this.completed.has(channel);
   }
   private async wait(name: string | undefined, signal?: AbortSignal): Promise<void> {
      if (name)
         await new Promise<void>((resolve, reject) => {
            signal?.throwIfAborted();
            const waiting = this.gates.get(name) ?? new Set<() => void>();
            const release = () => {
               signal?.removeEventListener("abort", abort);
               resolve();
            };
            const abort = () => {
               waiting.delete(release);
               if (!waiting.size) this.gates.delete(name);
               reject(new Error("Cancelled"));
            };
            waiting.add(release);
            this.gates.set(name, waiting);
            signal?.addEventListener("abort", abort, { once: true });
         });
   }
   async invoke<T>(channel: string, action: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
      this.calls.set(channel, this.count(channel) + 1);
      const rule = this.rules.get(channel) ?? {};
      await this.wait(rule.before, signal);
      let result: unknown = rule.previewSuffix === undefined ? await action() : this.sourceUrl + rule.previewSuffix;
      if (rule.rememberUrl) this.sourceUrl = (result as { url: string }).url;
      await this.wait(rule.after, signal);
      if (rule.patch) result = { ...(result as object), ...rule.patch };
      if (rule.unsupportedAudio) {
         const source = result as { streams: { type: string; codec: string }[] };
         result = { ...source, streams: source.streams.map((stream) => (stream.type === "audio" ? { ...stream, codec: "unsupported" } : stream)) };
      }
      this.completed.add(channel);
      return result as T;
   }
}
