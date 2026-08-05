import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

/**
 * Shared base flat config. Encodes the clean-architecture dependency rule from
 * PLAN §3.1 as import restrictions: the enterprise core (`@qale/domain`) may not
 * import infra, and the renderer may not import domain/infra directly.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'warn',
    },
  },
  {
    // The enterprise core must stay pure: only zod + itself.
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@qale/vault', '@qale/agent', '@qale/atlassian', '@qale/markdown', '@qale/ipc', '@qale/ui'],
              message: 'domain is the enterprise core — it may only depend on zod.',
            },
          ],
        },
      ],
    },
  },
  {
    // The renderer speaks DTOs over IPC — never domain or infra directly.
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@qale/domain', '@qale/vault', '@qale/agent', '@qale/atlassian', '@qale/application'],
              message: 'renderer is presentation-only — import @qale/ipc DTOs, not domain/infra.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '**/.turbo/**'],
  },
);
