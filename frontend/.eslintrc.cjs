module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended', 'plugin:react-hooks/recommended'],
  ignorePatterns: ['dist', 'coverage', 'node_modules', 'public'],
  rules: {
    // TypeScript performs the authoritative unused-symbol check during build.
    'no-unused-vars': 'off',
    'no-undef': 'off',
    // Existing modules intentionally colocate component helpers and types.
    'react-refresh/only-export-components': 'off',
    // Enable incrementally after stabilising the legacy async loaders.
    'react-hooks/exhaustive-deps': 'off',
    // TypeScript has separate type/value namespaces and supports declaration merging.
    'no-redeclare': 'off',
    'no-import-assign': 'off',
    // Legacy files contain mixed indentation; formatting is handled separately.
    'no-mixed-spaces-and-tabs': 'off',
  },
};
