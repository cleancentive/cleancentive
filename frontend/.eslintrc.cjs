/* eslint-env node */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: [
    'dist',
    'dev-dist',
    'coverage',
    'playwright-report',
    'test-results',
    '.browser-profile',
    '.eslintrc.cjs',
  ],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // `catch (err: any)` around axios errors is the established idiom here (see the
    // stores), and Nest-style `req: any` mirrors the backend. Enabling this rule would
    // demand a codebase-wide retyping rather than catch new defects.
    '@typescript-eslint/no-explicit-any': 'off',
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
  overrides: [
    {
      // Node-side files: Playwright specs, config, and the browser-launch scripts.
      files: ['e2e/**/*.ts', 'scripts/**/*.ts', '*.config.ts', '*.test.ts'],
      env: { node: true, browser: true },
      rules: {
        // Playwright fixtures are declared as `async ({}, testInfo) => …`; the empty
        // pattern is required syntax, not an oversight.
        'no-empty-pattern': 'off',
      },
    },
    {
      // A provider component and its companion hook belong in one file; splitting them
      // to satisfy fast-refresh's one-export-kind rule would not make the code better.
      files: ['src/lib/navHistory.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
}
