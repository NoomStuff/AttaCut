import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
   { ignores: ["out/**", "release/**", "resources/**", "work/**", "test-results/**"] },
   js.configs.recommended,
   ...ts.configs.recommended,
   {
      files: ["**/*.{ts,tsx}"],
      rules: { "@typescript-eslint/consistent-type-imports": "error", "@typescript-eslint/no-explicit-any": "error" },
   },
   {
      files: ["tests/ui/*.mjs"],
      languageOptions: { globals: { console: "readonly", process: "readonly", setTimeout: "readonly", document: "readonly" } },
   }
);
