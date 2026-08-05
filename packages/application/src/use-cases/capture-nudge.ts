import type { UseCaseContext } from '../ports.js';

/**
 * What the PO has waved off, for the capture nudge (docs/capture-nudge.md).
 *
 * The nudge itself is derived in the renderer from the tree — this is only the
 * memory of "don't ask me about this one again". It lives in the check ledger
 * rather than in localStorage because the answer is about these meetings: it has
 * to survive a moved workspace, and it has to be as durable as the note it is
 * about.
 *
 * Two levels, and the second is earned rather than configured: dismiss a single
 * meeting and that meeting goes quiet; dismiss a second one from the same
 * recurring series and the whole series does. A weekly sync nobody ever captures
 * costs two clicks, not a settings screen.
 */

/** One row per waved-off meeting; the value is its series (empty when none). */
const DISMISS_PREFIX = 'capture-nudge:';
/** One row per silenced series. */
const MUTE_PREFIX = 'capture-mute:';
/** Dismissals from one series before the series itself goes quiet. */
const MUTE_AFTER = 2;

export interface CaptureNudgeState {
  dismissed: string[];
  mutedSeries: string[];
}

export interface CaptureNudgeDismissal extends CaptureNudgeState {
  /** The series this dismissal just silenced, when it was the one that did. */
  mutedNow?: string;
}

const EMPTY: CaptureNudgeState = { dismissed: [], mutedSeries: [] };

export function captureNudgeState(ctx: UseCaseContext): CaptureNudgeState {
  const checks = ctx.checks;
  if (!checks) return EMPTY;
  return {
    dismissed: checks.list(DISMISS_PREFIX).map((r) => r.key.slice(DISMISS_PREFIX.length)),
    mutedSeries: checks.list(MUTE_PREFIX).map((r) => r.key.slice(MUTE_PREFIX.length)),
  };
}

/** The meeting's series, read from the index rather than taken on trust from
 *  the caller — the renderer asks about a path, not about a series. */
function seriesOf(ctx: UseCaseContext, path: string): string {
  const series = ctx.index.get(path)?.frontmatter['series'];
  return typeof series === 'string' ? series : '';
}

export function dismissCaptureNudge(
  ctx: UseCaseContext,
  path: string,
  now: number,
): CaptureNudgeDismissal {
  const checks = ctx.checks;
  if (!checks) return EMPTY;
  const series = seriesOf(ctx, path);
  checks.set(`${DISMISS_PREFIX}${path}`, series, now);

  let mutedNow: string | undefined;
  if (series && !checks.get(`${MUTE_PREFIX}${series}`)) {
    const fromSeries = checks.list(DISMISS_PREFIX).filter((r) => r.value === series).length;
    if (fromSeries >= MUTE_AFTER) {
      checks.set(`${MUTE_PREFIX}${series}`, String(now), now);
      mutedNow = series;
    }
  }
  return { ...captureNudgeState(ctx), ...(mutedNow ? { mutedNow } : {}) };
}

/**
 * Take a dismissal back. It undoes the series mute too: the mute is a
 * consequence of this click, and an undo that left the series silent would take
 * back the visible half of what just happened and keep the invisible half.
 */
export function undoCaptureNudge(
  ctx: UseCaseContext,
  path: string,
  series?: string,
): CaptureNudgeState {
  const checks = ctx.checks;
  if (!checks) return EMPTY;
  checks.remove(`${DISMISS_PREFIX}${path}`);
  const muted = series ?? seriesOf(ctx, path);
  if (muted) checks.remove(`${MUTE_PREFIX}${muted}`);
  return captureNudgeState(ctx);
}
