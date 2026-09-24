import { readFileSync } from "node:fs";

const expected = readFileSync(new URL("../.bun-version", import.meta.url), "utf8").trim();
const actual = process.versions["bun"] ?? "unknown";
if (actual !== expected) {
   throw new Error(`AttaCut requires Bun ${expected}; found ${actual}. Install Bun ${expected} before building or running release checks.`);
}
