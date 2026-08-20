import { refToSlug } from '@qale/domain';
import type { UseCaseContext } from '../ports.js';

/**
 * Reason lines (OW6) — the one line a run leaves behind when it looked at
 * something and deliberately chose not to cover it.
 *
 * Today a session that decides "not this pass" decides it in its own head. The
 * decision dies with the turn, so the next run either rediscovers the same area
 * from scratch or never sees it again, and either way nobody can tell a backlog
 * that is being worked from one that is quietly growing.
 *
 * The entry is deliberately the smallest durable thing that fixes that: a note
 * path, a reason, a stamp. No queue, no side table, no note in the vault. It
 * lives in the same check ledger the librarian's `seen`/`handled` rows live in,
 * so it survives a relaunch for free and it is read back the same way.
 *
 * ## The lifecycle
 * Written when a run defers. Fed into the NEXT librarian worklist, so the
 * following pass meets "previously deferred: X, because Y" beside its fresh
 * findings and can promote it the moment the evidence is there. Deleted when a
 * card against that note is approved — that IS the coverage — or when it decays,
 * or when the note it is anchored to stops existing.
 *
 * ## Why `kind`
 * M7 ("things end with a reason") wants the same shape for a different question:
 * a todo dropped, a capture row waved off, a theme moved to wont-do, each with
 * one line saying why. That is this record with a different `kind`, not a second
 * mechanism. Adding one is adding a string to {@link ReasonKind} and a caller;
 * the storage, the sanitising, the decay and the "clear it when the note gets
 * covered" hook are already here and already shared.
 */

/**
 * What a reason line is ABOUT. One today; M7 adds its own (`dropped`,
 * `wont-do`) beside it rather than building a second ledger.
 */
export type ReasonKind = 'deferred';

/** One reason line, as stored and as read back. */
export interface ReasonEntry {
  kind: ReasonKind;
  /** The note that anchors it. Always a real path in the index when read back. */
  notePath: string;
  /** One line, in the agent's own words. */
  reason: string;
  /** When it was written (epoch ms). */
  since: number;
}

const PREFIX = 'reason:';

/**
 * How long a reason line lives without being touched. Longer than the
 * librarian's week-long quiet window on purpose: a quiet window is "do not
 * mention this again yet", while a deferral is "this is still owed", and the
 * evidence that promotes it (an interview that lands, a decision that gets made)
 * routinely takes more than a week to arrive. A month is long enough to outlive
 * that wait and short enough that an area nobody ever came back to stops being
 * carried into every prompt forever.
 */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How many deferrals of one kind may be open at once. The point of the ticket is
 * that the backlog does not grow silently, and a cap is what keeps "silently"
 * out of it: at the ceiling the tool REFUSES rather than evicting the oldest, so
 * the run is told to work the backlog down instead of the workspace quietly
 * losing the entry it was about to lose.
 */
export const OPEN_REASON_CAP = 24;

/**
 * The most a reason may say. It is agent-written text that gets rendered back
 * into a later prompt (OW9), so it is kept to the length of a sentence: enough
 * for "waiting on the Q3 interviews", nowhere near enough to smuggle a second
 * set of instructions into the next run's worklist.
 */
export const REASON_MAX = 200;

/**
 * One line, always — the bar every scrap of unvetted text clears before it may
 * be pasted into a prompt a later run will read (OW9).
 *
 * Newlines, control characters and the external-material markers all come out,
 * because the only shape this text is ever allowed to take downstream is a
 * single bullet's tail. Three paragraphs become one sentence, truncated, rather
 * than three worklist lines the next run reads as three findings; and text
 * carrying `<<<END_EXTERNAL_MATERIAL>>>` cannot close an envelope it was pasted
 * inside.
 *
 * It lives here because this is where the bar was first set, and it is shared
 * rather than copied so the two halves of the guard cannot drift: the librarian
 * flattens the note titles it quotes into its worklist with this same function
 * (see ./librarian.ts), and a fix to one is a fix to both.
 */
export function oneLine(raw: string, max: number): string {
  const flat = (raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/<{3,}|>{3,}/g, '')
    .replace(/\s+/g, ' ')
    // A leading bullet or heading would have it read as structure rather than as
    // the tail of the line it is pasted into.
    .replace(/^[-*#>\s]+/, '')
    .trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** {@link oneLine} at a reason's own ceiling. */
export function oneLineReason(raw: string): string {
  return oneLine(raw, REASON_MAX);
}

function keyFor(kind: ReasonKind, notePath: string): string {
  return `${PREFIX}${kind}:${notePath}`;
}

/** `<stamp>|<reason>`; the reason keeps any pipe of its own, so split once. */
function parseValue(value: string): { since: number; reason: string } | null {
  const bar = value.indexOf('|');
  if (bar < 0) return null;
  const since = Number(value.slice(0, bar));
  const reason = value.slice(bar + 1).trim();
  if (!Number.isFinite(since) || !reason) return null;
  return { since, reason };
}

/**
 * The path this entry is anchored to, from whatever the model called it: a real
 * path, a slug, or a wikilink. An entry that cannot be tied to a note is refused
 * rather than stored loose — "anchored to a note" is half of what makes the
 * entry worth anything on the next pass.
 */
function resolveNotePath(ctx: UseCaseContext, ref: string): string | null {
  const raw = ref.trim();
  if (!raw) return null;
  if (ctx.index.get(raw)) return raw;
  const slug = refToSlug(raw) ?? raw.replace(/\.md$/, '');
  return ctx.index.resolve(slug);
}

export interface RecordReasonInput {
  kind: ReasonKind;
  /** Note path, slug or wikilink — resolved before anything is written. */
  note: string;
  reason: string;
}

export type RecordReasonResult =
  { ok: true; notePath: string; reason: string; replaced: boolean } | { ok: false; error: string };

/** Write (or overwrite) one reason line. */
export function recordReason(
  ctx: UseCaseContext,
  input: RecordReasonInput,
  now: number,
): RecordReasonResult {
  const checks = ctx.checks;
  if (!checks) return { ok: false, error: 'this workspace does not keep a ledger' };
  const notePath = resolveNotePath(ctx, input.note);
  if (!notePath) return { ok: false, error: `no note called “${input.note.trim()}”` };
  const reason = oneLineReason(input.reason ?? '');
  if (!reason)
    return { ok: false, error: 'a deferral without a reason is the thing this replaces' };

  const key = keyFor(input.kind, notePath);
  const replaced = checks.get(key) !== null;
  if (!replaced) {
    const open = listReasons(ctx, input.kind, now).length;
    if (open >= OPEN_REASON_CAP) {
      return {
        ok: false,
        error:
          `${open} areas are already deferred, which is the ceiling. Work some of them off ` +
          `before deferring anything else, or cover this one now.`,
      };
    }
  }
  checks.set(key, `${now}|${reason}`, now);
  return { ok: true, notePath, reason, replaced };
}

/**
 * Every open reason line of one kind, oldest first — and the only place they
 * expire. Reading is when we know both the clock and the index, so a row past
 * its TTL and a row whose note has been deleted are both dropped here, from the
 * ledger as well as from the result. Nothing sweeps this table on a timer, and
 * nothing needs to.
 */
export function listReasons(
  ctx: UseCaseContext,
  kind: ReasonKind,
  now: number,
  opts: { ttlMs?: number } = {},
): ReasonEntry[] {
  const checks = ctx.checks;
  if (!checks) return [];
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const out: ReasonEntry[] = [];
  for (const row of checks.list(`${PREFIX}${kind}:`)) {
    const notePath = row.key.slice(`${PREFIX}${kind}:`.length);
    const parsed = parseValue(row.value);
    if (!parsed || now - parsed.since >= ttlMs || !ctx.index.get(notePath)) {
      checks.remove(row.key);
      continue;
    }
    out.push({ kind, notePath, reason: parsed.reason, since: parsed.since });
  }
  return out.sort((a, b) => a.since - b.since || a.notePath.localeCompare(b.notePath));
}

/**
 * Forget every reason line anchored to this note, whatever its kind. Called on
 * an approved card: a card against the note IS the coverage the entry was
 * waiting for, so the entry has done its job and goes.
 */
export function clearReasons(ctx: UseCaseContext, notePath: string): number {
  const checks = ctx.checks;
  if (!checks) return 0;
  let cleared = 0;
  for (const row of checks.list(PREFIX)) {
    if (!row.key.endsWith(`:${notePath}`)) continue;
    checks.remove(row.key);
    cleared++;
  }
  return cleared;
}

/** {@link recordReason} for the one kind that exists today. */
export function recordDeferral(
  ctx: UseCaseContext,
  input: { note: string; reason: string },
  now: number,
): RecordReasonResult {
  return recordReason(ctx, { kind: 'deferred', ...input }, now);
}

/** {@link listReasons} for the one kind that exists today. */
export function listDeferrals(
  ctx: UseCaseContext,
  now: number,
  opts: { ttlMs?: number } = {},
): ReasonEntry[] {
  return listReasons(ctx, 'deferred', now, opts);
}
