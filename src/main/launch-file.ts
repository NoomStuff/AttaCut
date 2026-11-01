import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { videoExtensions } from "./media/formats";
import { projectExtensions } from "../shared/project";

/** Resolve shell paths before handing them to the existing app instance. */
export function fileArgument(args: string[], workingDirectory = process.cwd()): string | null {
   for (const arg of args) {
      if (arg.startsWith("-")) continue;
      let filename = arg;
      if (arg.startsWith("file:")) {
         try {
            filename = fileURLToPath(arg);
         } catch {
            continue;
         }
      }
      if (![...videoExtensions, ...projectExtensions].some((extension) => filename.toLowerCase().endsWith(`.${extension}`))) continue;
      const path = resolve(workingDirectory, filename);
      if (existsSync(path)) return path;
   }
   return null;
}
