import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React 19 advisory rule. Triggers on legitimate "sync external state
      // into local state" patterns (form prefill from props, ResizeObserver
      // dimension capture, dialog-open form reset). Keep as warning so it
      // surfaces in code review without blocking CI; refactor to derived
      // state opportunistically.
      "react-hooks/set-state-in-effect": "warn",
      // Errors that *do* indicate real correctness issues — keep strict.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
