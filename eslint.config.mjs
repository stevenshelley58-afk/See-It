import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      ".claude/**",
      ".taskmaster/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "supabase/**",
      "extension/**",
      "BUILD-SPEC.md"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    plugins: {
      "@next/next": nextPlugin
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@next/next/no-html-link-for-pages": "off"
    }
  }
];
