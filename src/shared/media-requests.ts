import { z } from "zod";
export const frameRequestSchema = z.object({
   sourceId: z.string(),
   time: z.number().finite().nonnegative(),
   directory: z.string().min(1),
   name: z.string().min(1).max(240),
   format: z.enum(["png", "jpg"]),
   quality: z.number().min(1).max(100),
});
export type FrameRequest = z.infer<typeof frameRequestSchema>;
export const frameTimeRequestSchema = z.object({
   sourceId: z.string(),
   time: z.number().finite().nonnegative(),
   direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
});
export type FrameTimeRequest = z.infer<typeof frameTimeRequestSchema>;
export const scrubRequestSchema = z.object({
   sourceId: z.string(),
   streamIndices: z.array(z.number().int()).min(1),
   time: z.number().finite().nonnegative().default(0),
});
export type ScrubRequest = z.input<typeof scrubRequestSchema>;
export const previewRequestSchema = z.object({
   sourceId: z.string(),
   audioIndices: z.array(z.number().int()),
   transcode: z.boolean(),
});
export type PreviewRequest = z.infer<typeof previewRequestSchema>;
export const waveformRequestSchema = z.object({
   sourceId: z.string(),
   streamIndices: z.array(z.number().int()).min(1),
   /** The media id to decode from: the source itself, or a prepared preview (compact and
       indexed) for recordings the browser cannot play directly. */
   decodeMediaId: z.string().optional(),
});
export type WaveformRequest = z.infer<typeof waveformRequestSchema>;
