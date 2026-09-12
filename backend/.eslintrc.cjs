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
    // TypeORM's Repository.clear() / EntityManager.clear(Entity) is TRUNCATE TABLE, not a
    // cache reset (TypeORM has no identity map). Two such calls, meant as a cache flush,
    // tried to truncate `spots` and `detected_items` on every item edit in production; only
    // the foreign keys stopped them, and the unhandled rejection crashed the API each time.
    'no-restricted-syntax': [
      'error',
      {
        selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='clear'][arguments.length=0]:not([callee.object.name=/^(cache|map|set|seen|pending|timers?)$/i])",
        message: 'Repository.clear() is TRUNCATE TABLE. Use delete({}) if you really mean to empty the table; there is no identity map to reset.',
      },
      {
        selector: "CallExpression[callee.type='MemberExpression'][callee.property.name='clear'][arguments.length=1][arguments.0.type='Identifier']",
        message: 'EntityManager.clear(Entity) is TRUNCATE TABLE, not a cache reset. Remove the call.',
      },
    ],
  },
}
