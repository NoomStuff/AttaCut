import { existsSync } from "node:fs";
import { localMediaEnv } from "../../scripts/provision-media.ts";

// Suites run in this order. Some read files that earlier suites write under work/.
const suites = [
   "architecture",
   "verification",
   "waveform",
   "scenes",
   "cut-accuracy",
   "formats",
   "metadata",
   "aspect",
   "dynamic-hdr",
   "keyframes",
   "cancellation",
   "exports",
   "joins",
   "output-options",
] as const;
type Suite = (typeof suites)[number];
const isSuite = (value: string): value is Suite => suites.some((suite) => suite === value);

// formats writes work/formats, metadata writes work/details from it.
const needs: Partial<Record<Suite, Suite[]>> = {
   metadata: ["formats"],
   keyframes: ["formats", "metadata"],
   exports: ["formats", "metadata"],
   "output-options": ["formats", "metadata"],
};
const outputs: Partial<Record<Suite, string>> = { formats: "work/formats/results.json", metadata: "work/details/multiple-tracks.mkv" };

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const requested = args.filter((arg) => arg !== "--fresh");
const unknown = requested.filter((name) => !isSuite(name));
if (unknown.length) throw new Error(`Unknown media suite ${unknown.join(", ")}. Choose from: ${suites.join(", ")}`);

let selected: Suite[] = [...suites];
if (requested.length) {
   const wanted = new Set(requested.filter(isSuite));
   for (const suite of requested.filter(isSuite)) {
      for (const need of needs[suite] ?? []) {
         const output = outputs[need];
         // Producer outputs are generated sources, so an earlier run's copy is reusable unless --fresh asks otherwise.
         if (fresh || wanted.has(need) || !output || !existsSync(output)) wanted.add(need);
         else console.log(`Reusing ${output} from an earlier ${need} run. Pass --fresh to rebuild it.`);
      }
   }
   selected = suites.filter((suite) => wanted.has(suite));
}

Object.assign(process.env, await localMediaEnv());
await import("../create-fixtures.ts");
for (const suite of selected) {
   console.log(`\n=== media: ${suite}`);
   await import(`./${suite}.ts`);
}
