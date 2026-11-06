import { z } from "zod";

export const recentFileSchema = z.object({
   path: z.string().min(1),
   name: z.string(),
   directory: z.string(),
   /** Source duration in seconds when it was last opened. */
   duration: z.number().nonnegative(),
   kind: z.enum(["video", "project"]),
});
export type RecentFile = z.infer<typeof recentFileSchema>;
/** A recent entry as the UI sees it: a moved or deleted file stays listed but cannot open. */
export type RecentEntry = RecentFile & { missing: boolean };
export const recentFileLimit = 10;
