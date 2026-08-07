// @ts-check
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

// NOTE on TypeScript linting: this repo intentionally does NOT run typescript-eslint
// against src/**/*.ts right now. typescript-eslint 8.x hard-refuses to run against
// TypeScript 7.0 (the native-compiler preview this project is pinned to) --
// `typescript-eslint does not support TS 7.0` is thrown at import time, not a warning,
// and it affects @typescript-eslint/parser and @typescript-eslint/eslint-plugin
// individually too, not just the umbrella package. Tracked upstream at
// https://github.com/typescript-eslint/typescript-eslint/issues/10940.
//
// Rather than downgrading TypeScript to work around a brand-new tool-compatibility gap,
// or silently skipping static analysis, this project uses two TS-version-independent
// gates instead:
//   1. `npm run typecheck` (tsc --noEmit, strict mode) -- real type-safety checking,
//      already caught and fixed several implicit-any bugs in src/mastra/tools.ts.
//   2. `npm run format:check` (Prettier) -- formatting, unaffected by the TS version
//      since Prettier bundles its own TS parser rather than using the project's tsc.
// Both run in CI (.github/workflows/ci.yml). Re-enable typescript-eslint here once it
// ships TS 7.0 support, or if this project is pinned back to TypeScript 6.x.
export default [
  {
    ignores: [
      "node_modules/**",
      ".mastra/**",
      "dist/**",
      "web-client/public/**",
      "public/**",
      "src/**/*.ts",
      "reminder-service/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        // Node.js server-side scripts (web-client/server-ui.js, this config file) --
        // avoiding the `globals` package here to keep this repo's dependency surface
        // small; this is the fixed, minimal set the Node.js runtime actually provides.
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "writable",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        fetch: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  eslintConfigPrettier,
];
