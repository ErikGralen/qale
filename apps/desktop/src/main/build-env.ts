/**
 * Values baked into the binary at build time.
 *
 * The main process reads `process.env` at RUNTIME, and a Mac app launched from
 * Finder inherits launchd's minimal environment, not the shell that built it. So
 * `process.env.QALE_GOOGLE_CLIENT_ID` is empty in every packaged build no matter
 * what was exported before `electron-builder`, and the feature it configures is
 * silently dead: Google Calendar reports "this build has no client configured",
 * telemetry never sends. Nothing fails loudly, which is what makes it expensive.
 *
 * So the value has to be substituted into the source at build time.
 * `electron.vite.config.ts` defines these constants from its own environment;
 * this module is the one place that reads them, with a `process.env` fallback so
 * a dev run can still set them from the shell (see turbo.json's `globalEnv` —
 * Turbo 2 strips anything undeclared before the task ever starts).
 *
 * These are functions, not constants, on purpose: a module-level constant here
 * would be read once per process and shared by every importer, so a test that
 * sets the variable and re-imports its own module would still see the first
 * value. Reading per call keeps the read where the caller expects it.
 *
 * Empty stays meaningful: it means this build cannot do that thing, and the
 * feature says so in plain language rather than half-working.
 */

/** Substituted by Vite's `define`. Declared, never bundled as a runtime lookup. */
declare const __QALE_POSTHOG_KEY__: string;
declare const __QALE_POSTHOG_HOST__: string;
declare const __QALE_POSTHOG_DEV__: string;
declare const __QALE_GOOGLE_CLIENT_ID__: string;
declare const __QALE_GOOGLE_CLIENT_SECRET__: string;

/**
 * Baked value first, shell second. `typeof` guards the case where the constant
 * was never defined at all — a `tsx` unit test, a script — which would otherwise
 * throw a ReferenceError rather than fall back.
 */
function baked(value: string | undefined, envName: string): string {
  if (value) return value;
  return process.env[envName] ?? '';
}

export const posthogKey = (): string =>
  baked(
    typeof __QALE_POSTHOG_KEY__ === 'string' ? __QALE_POSTHOG_KEY__ : undefined,
    'QALE_POSTHOG_KEY',
  );

export const posthogHost = (): string =>
  baked(
    typeof __QALE_POSTHOG_HOST__ === 'string' ? __QALE_POSTHOG_HOST__ : undefined,
    'QALE_POSTHOG_HOST',
  );

export const posthogDev = (): string =>
  baked(
    typeof __QALE_POSTHOG_DEV__ === 'string' ? __QALE_POSTHOG_DEV__ : undefined,
    'QALE_POSTHOG_DEV',
  );

export const googleClientId = (): string =>
  baked(
    typeof __QALE_GOOGLE_CLIENT_ID__ === 'string' ? __QALE_GOOGLE_CLIENT_ID__ : undefined,
    'QALE_GOOGLE_CLIENT_ID',
  );

export const googleClientSecret = (): string =>
  baked(
    typeof __QALE_GOOGLE_CLIENT_SECRET__ === 'string' ? __QALE_GOOGLE_CLIENT_SECRET__ : undefined,
    'QALE_GOOGLE_CLIENT_SECRET',
  );
