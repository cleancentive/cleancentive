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
    // `require('../package.json')` reports the build version at runtime; making it a
    // static import would pull package.json into the emitted bundle layout.
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
    ],
  },
}
