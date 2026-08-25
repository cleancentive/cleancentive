/* eslint-env node */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', 'coverage', '.eslintrc.cjs'],
  rules: {
    // `catch (err: any)` and Nest's `@Request() req: any` are the established idioms
    // across this workspace; enabling this would demand a wholesale retyping.
    '@typescript-eslint/no-explicit-any': 'off',
    // `require(path.join(process.cwd(), 'package.json'))` cannot be a static import,
    // and this tsconfig has no esModuleInterop — rewriting CJS requires as default
    // imports is exactly the change that has broken the production build before.
    '@typescript-eslint/no-var-requires': 'off',
    // A leading underscore marks a parameter that is deliberately accepted but not
    // used yet (audit fields, PKCE/nonce, RFC 7009 token_type_hint).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
  },
}
