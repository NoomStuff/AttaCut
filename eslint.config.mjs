import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
   // after-pack.cjs stays CommonJS because electron-builder loads hooks with require().
   { ignores: ["out/**", "release/**", "resources/**", "work/**", "test-results/**", "scripts/after-pack.cjs"] },
   js.configs.recommended,
   ...ts.configs.recommended,
   {
      files: ["**/*.{ts,tsx}"],
      rules: { "@typescript-eslint/consistent-type-imports": "error", "@typescript-eslint/no-explicit-any": "error" },
   },
   {
      files: ["src/renderer/**/*.{ts,tsx}"],
      rules: {
         "no-restricted-imports": [
            "error",
            { patterns: [{ group: ["electron", "node:*", "**/main/**", "**/preload/**"], message: "Use the desktop bridge for privileged operations." }] },
         ],
      },
   },
   {
      files: ["src/main/**/*.ts"],
      rules: {
         "no-restricted-imports": [
            "error",
            {
               patterns: [
                  {
                     group: ["**/renderer/**", "**/preload/**"],
                     message: "Put cross-process contracts in shared; main must not depend on renderer implementation.",
                  },
               ],
            },
         ],
      },
   },
   {
      files: ["src/shared/**/*.ts"],
      rules: {
         "no-restricted-imports": [
            "error",
            {
               patterns: [
                  {
                     group: ["electron", "node:*", "react", "react-dom", "react-dom/*", "**/main/**", "**/renderer/**", "**/preload/**"],
                     message: "Shared contracts and algorithms must remain independent of either process.",
                  },
               ],
            },
         ],
      },
   },
   {
      files: ["tests/ui/*.mjs"],
      languageOptions: { globals: { console: "readonly", process: "readonly", setTimeout: "readonly", document: "readonly" } },
   }
);
