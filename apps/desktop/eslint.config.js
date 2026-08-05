import react from '@qale/eslint-config/react';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...react,
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**'],
  },
];
