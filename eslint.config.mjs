import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

// Google-branded product names this plugin uses in its UI. Extend (rather than
// replace) the default Obsidian brand list so "Markdown", "Google Drive", etc.
// still get their canonical casing.
const BRANDS = [
  ...DEFAULT_BRANDS,
  "Google",
  "Google Doc",
  "Google Docs",
  "Google Cloud",
  "Google Cloud Console",
  "BRAT",
];

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
      "obsidianmd/ui/sentence-case": ["error", { brands: BRANDS }],
    },
  },
]);
