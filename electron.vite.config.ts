import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { RollupLog } from "rollup";

// zod's published code contains prose comments that mention `@__PURE__`; Rollup reads those
// as misplaced annotations (INVALID_ANNOTATION), strips them, and warns. Silence exactly that
// warning so annotation mistakes in first-party code still surface.
function ignoreZodCommentNoise(warning: RollupLog, warn: (log: RollupLog | string) => void): void {
   if (warning.code === "INVALID_ANNOTATION" && /[\\/]node_modules[\\/]zod[\\/]/.test(warning.id ?? "")) return;
   warn(warning);
}

export default defineConfig({
   main: { build: { rollupOptions: { onwarn: ignoreZodCommentNoise } } },
   preload: { build: { rollupOptions: { output: { format: "cjs", entryFileNames: "index.cjs" }, onwarn: ignoreZodCommentNoise } } },
   renderer: { plugins: [react()], build: { minify: true, rollupOptions: { onwarn: ignoreZodCommentNoise } } },
});
