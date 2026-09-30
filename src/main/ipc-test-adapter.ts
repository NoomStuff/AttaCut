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
   private async wait(name: string | undefined): Promise<void> {
      if (name)
         await new Promise<void>((resolve) => {
            const waiting = this.gates.get(name) ?? new Set<() => void>();
            waiting.add(resolve);
            this.gates.set(name, waiting);
         });
   }
   async invoke<T>(channel: string, action: () => T | Promise<T>): Promise<T> {
      this.calls.set(channel, this.count(channel) + 1);
      const rule = this.rules.get(channel) ?? {};
      await this.wait(rule.before);
      let result: unknown = rule.previewSuffix === undefined ? await action() : this.sourceUrl + rule.previewSuffix;
      if (rule.rememberUrl) this.sourceUrl = (result as { url: string }).url;
      await this.wait(rule.after);
      if (rule.patch) result = { ...(result as object), ...rule.patch };
      if (rule.unsupportedAudio) {
         const source = result as { streams: { type: string; codec: string }[] };
         result = { ...source, streams: source.streams.map((stream) => (stream.type === "audio" ? { ...stream, codec: "unsupported" } : stream)) };
      }
      this.completed.add(channel);
      return result as T;
   }
}
