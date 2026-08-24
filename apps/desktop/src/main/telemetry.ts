import { randomBytes } from 'node:crypto';
import {
  TELEMETRY_ENVS,
  VIEW_KINDS,
  filterTelemetryProps,
  telemetryAllows,
  telemetryEvent,
  type TelemetryEnv,
  type TelemetryValue,
} from '@qale/ipc';
import { posthogDev, posthogHost, posthogKey } from './build-env.js';
import { redactLogLine } from './log.js';

/**
 * The sender (docs/telemetry-posthog.md TEL-2, TEL-3, TEL-4, TEL-6).
 *
 * It lives in main and only in main. Packaged builds run under
 * `connect-src 'self'`, every event we want already flows through the
 * handlers, and the project token never enters the renderer bundle.
 *
 * Three rules it holds, in order of how much they matter:
 *
 * 1. It can never affect the thing it observes. Every path catches, nothing
 *    throws, no caller ever awaits it.
 * 2. It sends only what `@qale/ipc` declares — the event names AND their
 *    properties — so the consent screen, which renders that same list, can
 *    never promise less than we send.
 * 3. Nothing goes out before the person has answered the consent screen. On a
 *    first run that screen comes several steps in, so events that happen before
 *    it wait in memory and are either flushed or dropped by the answer.
 */

/** PostHog Cloud EU. Never fall back to the library's US default. */
const DEFAULT_HOST = 'https://eu.i.posthog.com';

/**
 * Empty means this build has no sender at all, which is the default and the
 * reason a dev run costs nothing and pollutes nothing. Turning it on is the
 * deliberate act (TEL-2).
 */
const TOKEN = posthogKey();
const HOST = posthogHost() || DEFAULT_HOST;
/** One project is shared with dev on the free tier, so dev stamps itself. */
const ENV: TelemetryEnv = posthogDev() === '1' ? 'dev' : 'beta';

/** Events waiting on the consent answer. Bounded: a first run is not long. */
const MAX_HELD = 100;

/** How long a flush may hold up the quit, inside the 5s teardown watchdog. */
const SHUTDOWN_MS = 1500;

/**
 * Person properties, allowlisted exactly like event properties. This is where
 * the name and the work email live (TEL-4), which is the whole reason the list
 * is closed: everything else about a person stays a count or a flag.
 *
 * The connection flags are named here for the same reason they are named in the
 * event allowlist: the consent screen renders these words. The caller builds
 * its flags from the connector registry and hands over whatever it has; a
 * connector nobody has named yet is dropped here rather than sent.
 */
const PERSON_PROPS = [
  'name',
  'email',
  'appVersion',
  'platform',
  'arch',
  'packaged',
  'env',
  'hasKey',
  'google',
  'atlassian',
  'notes',
  'meetings',
  'people',
  'todos',
  'customSkills',
] as const;

export type PersonProps = Partial<Record<(typeof PERSON_PROPS)[number], TelemetryValue>>;

/**
 * What we use of posthog-node, so a test can stand in for it.
 *
 * `shutdown` is typed as returning `unknown` on purpose: the library declares
 * it `void` but hands back a promise, and we would rather wait for the real
 * flush than trust either half of that.
 */
export interface TelemetrySink {
  capture(payload: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void;
  shutdown(timeoutMs?: number): unknown;
}

export interface TelemetryFacts {
  appVersion: string;
  platform: string;
  arch: string;
  packaged: boolean;
}

/** Where a crash came from, in the words the allowlist knows. */
export type CrashOrigin = 'main' | 'promise' | 'renderer' | 'child';

/**
 * One id per run of the app, sent as `$session_id` so PostHog reads a launch to
 * quit as one session. A UUIDv7 because that is the shape PostHog's session
 * tools expect: the first 48 bits are the mint time, the rest is random. It
 * carries nothing else and is never stored.
 */
function mintRunId(): string {
  const b = randomBytes(16);
  const t = Date.now();
  b[0] = (t / 2 ** 40) & 0xff;
  b[1] = (t / 2 ** 32) & 0xff;
  b[2] = (t / 2 ** 24) & 0xff;
  b[3] = (t / 2 ** 16) & 0xff;
  b[4] = (t / 2 ** 8) & 0xff;
  b[5] = t & 0xff;
  b[6] = ((b[6] as number) & 0x0f) | 0x70;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface Held {
  event: string;
  props: Record<string, TelemetryValue>;
  /** The view that was open when the event happened, not when it drains. */
  view: string | null;
}

export class Telemetry {
  private sink: TelemetrySink | null = null;
  private starting = false;
  /** The consent switch. */
  private consented = false;
  /**
   * Whether we have READ the switch yet, which is not the same as it being
   * false. Settings load a moment after the process does, and the most valuable
   * crash there is happens in that moment. So an event raised before the first
   * {@link setConsent} waits with the rest of the backlog rather than being
   * dropped, and the answer, when it comes, either releases it or clears it.
   */
  private consentKnown = false;
  /** Whether the PM has actually SEEN the consent screen yet. */
  private answered = false;
  private held: Held[] = [];
  private person: PersonProps = {};
  private distinctId: string | null = null;
  /** The last view the renderer reported. Null until the first report lands. */
  private view: string | null = null;
  /** This run's `$session_id`. One per process, minted before anything sends. */
  private readonly runId = mintRunId();
  /** Set by {@link shutdown}. A late event must not build a new client mid-quit. */
  private stopped = false;

  constructor(
    private readonly facts: TelemetryFacts,
    /** Injected in tests; production builds it from the env token. */
    private readonly injected?: TelemetrySink,
  ) {}

  /**
   * The install id, once settings have been loaded. Nothing can be sent before
   * this: an event with no one attached to it would be a row we could never
   * answer a question with. Events raised earlier wait, like the consent ones.
   *
   * A dev run's person is obviously ours at a glance, in the person list as
   * well as in the events.
   */
  bind(installId: string): void {
    this.distinctId = ENV === 'dev' ? `dev-${installId}` : installId;
    if (this.answered) this.drain();
  }

  /** Is there a token at all? False in every ordinary dev run. */
  get configured(): boolean {
    return Boolean(this.injected) || TOKEN.length > 0;
  }

  /**
   * The consent switch and whether it has been answered yet.
   *
   * Called on load and again whenever settings change. Turning consent off
   * drops whatever was waiting: off means off, including the backlog.
   */
  setConsent(consented: boolean, answered: boolean): void {
    this.consentKnown = true;
    this.consented = consented;
    this.answered = answered;
    if (!consented) {
      this.held = [];
      return;
    }
    if (answered) this.drain();
  }

  /**
   * Which part of the app is open right now. The renderer reports it through
   * `telemetry:view`, and it is remembered here so every later event says where
   * it happened: a card decided in the Inbox and one decided from a session
   * review are different facts about the product. Only words from the closed
   * set are kept; a stray string is dropped, never stamped.
   */
  setView(view: string): void {
    if ((VIEW_KINDS as readonly string[]).includes(view)) this.view = view;
  }

  /**
   * Who this is (TEL-4). Merged, so a later launch can add what screen 2 gave
   * us. The parameter is wide on purpose: callers build some of these keys from
   * a registry, and {@link PERSON_PROPS} is what decides which of them survive.
   */
  describe(props: Readonly<Record<string, TelemetryValue | undefined>>): void {
    for (const key of PERSON_PROPS) {
      const value = props[key];
      if (value !== undefined && value !== null) this.person[key] = value;
    }
  }

  /**
   * Send one event, if it is one of ours and consent allows it.
   *
   * Fire and forget from wherever the real event already flows. Same discipline
   * as `markFirstStep` in the handlers, and for the same reason: an observer
   * that can fail the thing it observes is worse than no observer.
   */
  send(event: string, props?: Record<string, unknown>): void {
    try {
      if (!this.configured || this.stopped) return;
      // The allowlist first, and on its own: an event nobody put on the list is
      // refused whatever the switch says, and must not even be held.
      if (!telemetryEvent(event)) return;
      const filtered = filterTelemetryProps(event, props);
      // The view is read here, when the event happens, so one that waits on
      // consent keeps the screen it happened on rather than gaining the one
      // the backlog drains under.
      const view = this.view;
      if (!this.consentKnown || !this.answered || !this.distinctId) {
        if (this.held.length < MAX_HELD) this.held.push({ event, props: filtered, view });
        return;
      }
      if (!telemetryAllows(this.consented, event)) return;
      this.emit(event, filtered, view);
    } catch {
      // An observer never throws into what it observes.
    }
  }

  /**
   * A crash, scrubbed. The stack is the only string in the whole scheme that
   * can carry the PM's world (their home directory, their note names), so it
   * goes through the same scrubber the in-memory log uses before it is even
   * offered to the filter.
   */
  crash(origin: CrashOrigin, error: unknown): void {
    try {
      const err = error instanceof Error ? error : new Error(String(error));
      this.send('app.crashed', {
        origin,
        name: redactLogLine(err.name),
        message: redactLogLine(err.message),
        stack: err.stack ? redactLogLine(err.stack) : undefined,
      });
    } catch {
      // As above.
    }
  }

  /** Flush and stop. Bounded, so a dead network cannot slow a quit. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    const sink = this.sink;
    this.sink = null;
    this.held = [];
    if (!sink) return;
    await Promise.race([
      Promise.resolve(sink.shutdown(SHUTDOWN_MS)).then(
        () => {},
        () => {},
      ),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_MS)),
    ]);
  }

  private drain(): void {
    if (!this.distinctId || !this.consentKnown || !this.consented) return;
    const waiting = this.held;
    this.held = [];
    for (const item of waiting) this.emit(item.event, item.props, item.view);
  }

  private emit(event: string, props: Record<string, TelemetryValue>, view: string | null): void {
    const sink = this.sink;
    const distinctId = this.distinctId;
    if (!distinctId) return;
    if (!sink) {
      // The client is still coming up. Hold rather than drop, then let the
      // start finish the job.
      if (this.held.length < MAX_HELD) this.held.push({ event, props, view });
      void this.start();
      return;
    }
    sink.capture({
      distinctId,
      event,
      properties: {
        // The context stamps (TELEMETRY_CONTEXT in @qale/ipc): where in the app
        // it happened, and which run of the app it belongs to. First, so an
        // event's own declared property of the same name wins.
        ...(view ? { view } : {}),
        ...props,
        $session_id: this.runId,
        env: ENV,
        appVersion: this.facts.appVersion,
        platform: this.facts.platform,
        arch: this.facts.arch,
        packaged: this.facts.packaged,
        $set: { ...this.person, env: ENV },
      },
    });
  }

  /**
   * Build the client on first use. Imported lazily so that importing this
   * module — in a test, or in a build with no token — costs nothing.
   */
  private async start(): Promise<void> {
    if (this.sink || this.starting || this.stopped) return;
    this.starting = true;
    try {
      if (this.injected) {
        this.sink = this.injected;
      } else {
        const { PostHog } = await import('posthog-node');
        this.sink = new PostHog(TOKEN, {
          host: HOST,
          // We do not want a city column and should not have one.
          disableGeoip: true,
        }) as unknown as TelemetrySink;
      }
      if (this.consented && this.answered) this.drain();
    } catch {
      // No sink, no telemetry, no noise. The app does not care.
    } finally {
      this.starting = false;
    }
  }
}

/** The stamp every event carries, exported so a test can assert on it. */
export const TELEMETRY_ENV: TelemetryEnv = ENV;

/** Guard against a typo in the env stamp ever shipping. */
export const TELEMETRY_ENV_IS_KNOWN = TELEMETRY_ENVS.includes(ENV);
