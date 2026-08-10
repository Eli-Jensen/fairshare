import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// The theme system lives or dies by semantic tokens (bg-card, text-text…) —
// a hardcoded palette class renders wrong in one of the two themes. Ban the
// standard Tailwind palette names in string literals; the custom theme
// scales (accent, warn, danger…) are untouched. (Pattern shared with the
// sibling good-boy-points app.)
const PALETTE =
  '(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow|accent|caret)-' +
  '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}'

export default defineConfig([
  // .claude holds throwaway git worktrees (full repo copies) — linting them
  // double-reports everything and confuses typescript-eslint's project root.
  globalIgnores(['dist', 'functions/lib', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['functions/**'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      // Accessibility linting. The plugin's peer range predates ESLint 10 —
      // package.json `overrides` forces the resolution; the rules themselves
      // run fine (verified against a deliberate violation).
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Downgraded from the preset's error: several instances are legitimate
      // one-shot syncs from router/navigation state (e.g. TripDashboard's
      // deleted-expense toast handoff), and rewriting every effect in an app
      // with no component tests is its own project. New code should still
      // heed the warning.
      'react-hooks/set-state-in-effect': 'warn',
      // The context files export a Provider component AND its useX hook —
      // splitting them buys nothing but import churn; the cost is merely a
      // full-reload HMR for those files.
      'react-refresh/only-export-components': 'warn',
      // Every autoFocus here is a field revealed by an explicit user action
      // (rename, invite, custom amount) — focusing it IS the accessible
      // behavior. The rule targets page-load focus stealing, which none of
      // these are.
      'jsx-a11y/no-autofocus': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/\\b${PALETTE}\\b/]`,
          message:
            'Hardcoded Tailwind palette class — use semantic tokens (bg-card, text-text, border-line…) so both themes render right.',
        },
        {
          selector: `TemplateElement[value.raw=/\\b${PALETTE}\\b/]`,
          message:
            'Hardcoded Tailwind palette class — use semantic tokens (bg-card, text-text, border-line…) so both themes render right.',
        },
      ],
    },
  },
  {
    // Cloud Functions run in Node, not the browser — no React plugins, and
    // `process`/`setTimeout` come from node globals rather than the DOM.
    files: ['functions/src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
])
