import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

// Use the obsidianmd recommended config as-is — the community plugin review bot
// runs with default brands, so we match that baseline locally to catch the same
// violations it will flag.
export default defineConfig([
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    ignores: ["node_modules/**", "main.js"],
    rules: {
      "obsidianmd/ui/sentence-case": ["error", { allowAutoFix: true }],
    },
  },
]);
