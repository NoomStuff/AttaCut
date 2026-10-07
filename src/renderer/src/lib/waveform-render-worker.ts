import { createWaveformData, drawWaveformDataBand, fillWaveformData, waveformDuration } from "./waveform-data";
import type { WaveformMessage, WaveformView, WaveformBand } from "./waveform-renderer";
import { WaveformReveal } from "./waveform-reveal";

const port = globalThis as unknown as { onmessage: (event: MessageEvent<WaveformMessage>) => void };
let waveform: ReturnType<typeof createWaveformData> | null = null;
const views = new Map<number, { canvas: OffscreenCanvas; context: OffscreenCanvasRenderingContext2D; view: WaveformView; dirty: boolean }>();
let timer: ReturnType<typeof setTimeout> | undefined;
const reveal = new WaveformReveal();
let paintedSeconds = -1;
let priorityBands: { from: number; to: number; reveal: WaveformReveal }[] = [];
let paintedPriority = "";

function schedule(): void {
   if (timer === undefined && views.size) timer = setTimeout(paint, 33);
}
function paint(): void {
   timer = undefined;
   if (!waveform) return;
   const reducedMotion = [...views.values()].every((entry) => entry.view.reducedMotion);
   const { seconds, active } = reveal.frame(performance.now(), reducedMotion);
   priorityBands = priorityBands.filter((band) => band.to > seconds);
   const priorityFrames = priorityBands.map((band) => ({ ...band, frame: band.reveal.frame(performance.now(), reducedMotion) }));
   const priorityActive = priorityFrames.some((band) => band.frame.active);
   const prioritySignature = JSON.stringify(priorityFrames.map((band) => [band.from, band.frame.seconds, band.frame.active]));
   const priorityChanged = prioritySignature !== paintedPriority;
   paintedPriority = prioritySignature;
   const before = paintedSeconds;
   paintedSeconds = seconds;
   for (const entry of views.values()) {
      if (!entry.dirty && before === seconds && !priorityChanged) continue;
      entry.dirty = false;
      const { canvas, context, view } = entry;
      if (canvas.width !== view.width) canvas.width = view.width;
      if (canvas.height !== view.height) canvas.height = view.height;
      context.clearRect(0, 0, view.width, view.height);
      const draw = (band: WaveformBand, from: number, to: number, revealedSeconds: number, fadeSeconds = band.fadeSeconds) => {
         if (to <= from || revealedSeconds <= from) return;
         const scale = band.width / (band.to - band.from);
         const width = (to - from) * scale;
         context.save();
         context.translate(band.left + (from - band.from) * scale, 0);
         context.beginPath();
         context.rect(0, 0, width, view.height);
         context.clip();
         drawWaveformDataBand({ context, waveform: waveform!, ...band, from, to, width, fadeSeconds, height: view.height, revealedSeconds, alpha: 0.55 });
         context.restore();
      };
      for (const band of view.bands) {
         draw(band, band.from, band.to, seconds);
         for (const range of priorityFrames) {
            draw(band, Math.max(band.from, range.from, seconds), Math.min(band.to, range.to), range.frame.seconds, range.frame.active ? band.fadeSeconds : 0);
         }
      }
   }
   if (active || priorityActive) schedule();
}

port.onmessage = ({ data: message }) => {
   if (message.type === "init") waveform = createWaveformData(message.duration);
   else if (message.type === "peaks" && waveform) {
      fillWaveformData(waveform.levels, message.offset, message.peaks);
      const rate = waveform.levels[0]!.rate;
      const from = message.offset / rate;
      const to = (message.offset + message.peaks.length / 3) / rate;
      if (message.priority) {
         let range = priorityBands.find((range) => range.from <= from && range.to + 1 / rate >= from);
         if (!range) {
            range = { from, to, reveal: new WaveformReveal(from) };
            priorityBands.push(range);
            if (priorityBands.length > 128) priorityBands.shift();
         }
         range.to = Math.max(range.to, to);
         range.reveal.retarget(range.to, performance.now());
      } else {
         waveform.filled = (message.offset + message.peaks.length / 3) / waveform.levels[0]!.down.length;
         reveal.retarget(waveform.filled * waveformDuration(waveform), performance.now());
      }
      for (const entry of views.values()) entry.dirty = true;
   } else if (message.type === "complete" && waveform) {
      waveform.filled = 1;
      reveal.retarget(waveformDuration(waveform), performance.now());
   } else if (message.type === "attach") {
      // Allocate the visible strip, not the HTML canvas default of 300 by 150.
      message.canvas.width = message.view.width;
      message.canvas.height = message.view.height;
      // Keep this tiny strip in software. GPU-backed worker canvases compete with
      // video compositing; the 1,000-clip benchmark catches the resulting frame drops.
      const context = message.canvas.getContext("2d", { willReadFrequently: true });
      if (context) views.set(message.id, { canvas: message.canvas, context, view: message.view, dirty: true });
   } else if (message.type === "view") {
      const entry = views.get(message.id);
      if (entry) {
         entry.view = message.view;
         entry.dirty = true;
      }
   } else if (message.type === "remove") views.delete(message.id);
   schedule();
};
