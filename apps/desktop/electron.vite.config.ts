import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Internal `@pm/*` packages are Just-in-Time (TS source, no build step, PLAN §3.1).
// They must be BUNDLED into main/preload, not externalized like real node_modules —
// otherwise Node tries to `require` raw .ts at runtime. Native/real deps
// (better-sqlite3, @earendil-works/*, chokidar) stay external via the default rule.
const WORKSPACE_PACKAGES = [
  '@pm/ipc',
  '@pm/domain',
  '@pm/application',
  '@pm/markdown',
  '@pm/vault',
  '@pm/agent',
  '@pm/atlassian',
];

// One config drives all three Electron layers (PLAN §2). Main is ESM; the
// preload is forced to CommonJS (`.cjs`) so it can run with `sandbox: true`
// (sandboxed preloads cannot be ES modules).
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@pm/ipc'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
