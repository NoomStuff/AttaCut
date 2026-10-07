export interface WaveformView {
   width: number;
   height: number;
   bands: WaveformBand[];
   reducedMotion?: boolean;
}
export interface WaveformBand {
   from: number;
   to: number;
   left: number;
   width: number;
   color: string;
   fadeSeconds: number;
}
export type WaveformMessage =
   | { type: "init"; duration: number }
   | { type: "peaks"; offset: number; peaks: Uint8Array; priority?: boolean }
   | { type: "complete" }
   | { type: "attach"; id: number; canvas: OffscreenCanvas; view: WaveformView }
   | { type: "view"; id: number; view: WaveformView }
   | { type: "remove"; id: number };

/** Peaks and pixels belong to a worker. React only holds this stable handle. */
export class WaveformRenderer {
   readonly id = crypto.randomUUID();
   private worker = new Worker(new URL("./waveform-render-worker.ts", import.meta.url), { type: "module" });
   private sequence = 0;
   private views = new Map<HTMLCanvasElement, { id: number; view: WaveformView; signature: string }>();
   private observer: MutationObserver;
   private colors = new Map<string, string>();
   private region: (from: number, to: number) => void;
   constructor(duration: number, failed: () => void, region: (from: number, to: number) => void) {
      this.region = region;
      this.worker.onerror = () => failed();
      this.send({ type: "init", duration });
      this.observer = new MutationObserver(() => {
         this.colors.clear();
         for (const [canvas, entry] of this.views) {
            this.sendView(canvas, entry);
         }
      });
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme"] });
   }
   private send(message: WaveformMessage, transfer: Transferable[] = []): void {
      this.worker.postMessage(message, transfer);
   }
   append(offset: number, peaks: Uint8Array, priority = false): void {
      // IPC owns this view exclusively; move its storage rather than copying it again.
      this.send({ type: "peaks", offset, peaks, priority }, [peaks.buffer as ArrayBuffer]);
   }
   complete(): void {
      this.send({ type: "complete" });
   }
   private resolveView(canvas: HTMLCanvasElement, view: WaveformView): WaveformView {
      return {
         ...view,
         bands: view.bands.map((band) => {
            let color = this.colors.get(band.color);
            if (!color) {
               canvas.style.color = band.color;
               color = getComputedStyle(canvas).color;
               this.colors.set(band.color, color);
            }
            return { ...band, color };
         }),
      };
   }
   private sendView(canvas: HTMLCanvasElement, entry: { id: number; view: WaveformView }): void {
      this.send({ type: "view", id: entry.id, view: this.resolveView(canvas, entry.view) });
      this.requestRegion(entry.view);
   }
   private requestRegion(view: WaveformView): void {
      if (!view.bands.length) return;
      const from = Math.min(...view.bands.map((band) => band.from));
      const to = Math.max(...view.bands.map((band) => band.to));
      if (to - from <= 60) this.region(from, to);
   }
   attach(canvas: HTMLCanvasElement, view: WaveformView): () => void {
      const id = ++this.sequence;
      const offscreen = canvas.transferControlToOffscreen();
      this.views.set(canvas, { id, view, signature: JSON.stringify(view) });
      this.send({ type: "attach", id, canvas: offscreen, view: this.resolveView(canvas, view) }, [offscreen]);
      this.requestRegion(view);
      return () => {
         this.views.delete(canvas);
         this.send({ type: "remove", id });
      };
   }
   update(canvas: HTMLCanvasElement, view: WaveformView): void {
      const entry = this.views.get(canvas);
      if (!entry) return;
      const signature = JSON.stringify(view);
      if (entry.signature === signature) return;
      entry.signature = signature;
      entry.view = view;
      this.sendView(canvas, entry);
   }
   dispose(): void {
      this.observer.disconnect();
      this.views.clear();
      this.worker.terminate();
   }
}
