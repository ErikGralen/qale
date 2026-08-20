import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Internal `@qale/*` packages are Just-in-Time (TS source, no build step, PLAN §3.1).
// They must be BUNDLED into main/preload, not externalized like real node_modules —
// otherwise Node tries to `require` raw .ts at runtime. Native/real deps
// (better-sqlite3, @earendil-works/*, chokidar) stay external via the default rule.
const WORKSPACE_PACKAGES = [
  '@qale/ipc',
  '@qale/domain',
  '@qale/application',
  '@qale/markdown',
  '@qale/vault',
  '@qale/agent',
  '@qale/atlassian',
  '@qale/sessions',
  '@qale/connectors',
];

// One config drives all three Electron layers (PLAN §2). Main is ESM; the
// preload is forced to CommonJS (`.cjs`) so it can run with `sandbox: true`
// (sandboxed preloads cannot be ES modules).
// The repo-root `.env` (gitignored; `.env.example` documents it) so a build does
// not depend on remembering to export anything. Anything already in the
// environment WINS over the file, which is what makes a one-off override on the
// command line, or a CI secret, still work. Missing file is the normal case for
// a fresh clone and simply means an unconfigured build.
const ENV_FILE = resolve(__dirname, '../../.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

// Secrets and ids the packaged app needs at runtime. They must be SUBSTITUTED
// into the source here, not read from `process.env` in the main process: an app
// launched from Finder gets launchd's environment, so a runtime lookup is always
// empty in a packaged build and the feature it configures dies quietly. Read
// through src/main/build-env.ts, which falls back to `process.env` for dev.
const BAKED_ENV = [
  'QALE_POSTHOG_KEY',
  'QALE_POSTHOG_HOST',
  'QALE_POSTHOG_DEV',
  'QALE_GOOGLE_CLIENT_ID',
  'QALE_GOOGLE_CLIENT_SECRET',
];
const define = Object.fromEntries(
  // `?? ''` matters: an undefined value would emit the bare token `undefined`.
  BAKED_ENV.map((name) => [`__${name}__`, JSON.stringify(process.env[name] ?? '')]),
);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    define,
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@qale/ipc'] })],
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
