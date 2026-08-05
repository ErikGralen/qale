import { isFolderIndex, suggestLinkCandidates, type LinkRepairCandidate } from '@qale/domain';
import type { UseCaseContext } from '../ports.js';
import { getMaintenanceReport, isWorkspaceMachinery } from './vault.js';
import { logSweepError, selectDriftPairs, type DriftPair } from './wikipage-drift.js';

/**
 * The librarian's maintenance tick (docs/librarian-agentic.md). It scans, and
 * that is the whole of its judgment: whether a wikilink resolves, whether a note
 * has any links, which mirrored pages sit in a decision's orbit. All graph
 * facts. What a broken link MEANT, what an unlinked note IS, whether a page
 * really contradicts a decision: those need somebody to read the notes, so they
 * belong to a librarian session, which this hands a worklist to.
 *
 * Everything else here is about time and money rather than meaning. A finding
 * has to survive a settle window before the agent hears about it, so a link the
 * PM is mid-way through typing is never repaired out from under them; once it
 * has been handed over it goes quiet for a week rather than for good; a session
 * fires at most once per interval; and the tick stays quiet while the
 * librarian's own cards are already stacked up waiting.
 */

/** One thing the scan found, in the shape the ledger and the worklist both need. */
export interface LibrarianFinding {
  /** Ledger key. Stable per finding: see the key formats below. */
  key: string;
  kind: 'broken-link' | 'unlinked-note' | 'page-drift';
  /**
   * What makes this finding THIS version of itself. Unchanged revision means the
   * agent already saw exactly this and must not be asked again.
   */
  revision: string;
  /** The worklist line the agent reads. One finding, one line. */
  line: string;
}

/** What the tick decided to do. */
export interface LibrarianWork {
  findings: LibrarianFinding[];
  /** The kickoff instruction, worklist included. */
  worklist: string;
}

export interface LibrarianSweepOptions {
  settleMs?: number;
  intervalMs?: number;
  quietMs?: number;
  cardCap?: number;
  worklistMax?: number;
}

/** One maintenance tick, which is how long a finding has to hold still. */
const DEFAULT_SETTLE_MS = 5 * 60 * 1000;
/** However busy the workspace, the librarian gets a session this often at most. */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
/**
 * How long a finding stays quiet after being handed to a session. Long enough
 * that a declined card is not re-raised at the PM this week, short enough that a
 * problem nobody actually fixed gets looked at again while it still matters.
 */
const DEFAULT_QUIET_MS = 7 * 24 * 60 * 60 * 1000;
/** Cards the librarian may have waiting before the tick stops adding to the pile. */
const DEFAULT_CARD_CAP = 8;
/**
 * One worklist never hands over more than this; the rest wait for the next pass.
 * The number is set by what one unattended run can honestly do: the agent reads
 * every note on the list itself before it decides anything, and a dozen is about
 * as far as that goes before reading turns into skimming.
 */
const DEFAULT_WORKLIST_MAX = 12;
/** Similar existing pages offered per broken link. */
const HINTS_PER_LINK = 3;

/** Epoch ms of the last librarian session. Durable so a relaunch does not fire one. */
const LAST_RUN_KEY = 'librarian:last-run';

/**
 * A ledger row: what state this finding is in, at which revision, since when.
 * `handled` means a session was handed this finding at that stamp, which is why
 * the stamp matters as much as the state: see the quiet window below.
 *
 * Rows written before the sweep became agentic hold a bare revision and nothing
 * else. They are read as `handled` with a zero stamp, because that is what they
 * meant: this exact pair was already judged once, and an upgrade must not
 * re-raise every drift finding the workspace has ever settled.
 */
interface LedgerRow {
  state: 'seen' | 'handled';
  revision: string;
  stamp: number;
}

function parseRow(value: string | null): LedgerRow | null {
  if (value === null) return null;
  const parts = value.split('|');
  const state = parts[0];
  // A drift revision carries a pipe of its own (`d:<mtime>|p:<version>`), so the
  // revision is everything BETWEEN the state and the stamp, not `parts[1]`.
  if (parts.length >= 3 && (state === 'seen' || state === 'handled')) {
    const stamp = Number(parts.at(-1));
    if (Number.isFinite(stamp)) return { state, revision: parts.slice(1, -1).join('|'), stamp };
  }
  return { state: 'handled', revision: value, stamp: 0 };
}

function rowValue(state: LedgerRow['state'], revision: string, now: number): string {
  return `${state}|${revision}|${now}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Every page a broken link could plausibly have meant, for the hint tiers. The
 * workspace's own machinery is not one of them: `[[librarian]]` in somebody's
 * note is not a bid to link the agent file, and a hint naming one only invites
 * the agent to repoint a page at the plumbing.
 */
function linkCandidatePool(ctx: UseCaseContext): LinkRepairCandidate[] {
  return ctx.index
    .all()
    .filter((n) => !isFolderIndex(n.path) && !isWorkspaceMachinery(n.type))
    .map((n) => ({ slug: n.slug, title: n.title }));
}

function driftLine(pair: DriftPair): string {
  const older = pair.chain.slice(0, -1);
  const replaced =
    older.length > 0 ? ` It replaced ${older.map((c) => `"${c.title}"`).join(', ')}.` : '';
  return (
    `- Page drift: "${pair.page.title}" ([[${pair.page.slug}]], ${pair.page.provider}, ${pair.page.url})` +
    ` sits in the orbit of the decision "${pair.decision.title}" ([[${pair.decision.slug}]]).` +
    ` Check whether the page contradicts it as it stands.${replaced}`
  );
}

/**
 * Everything the scan found, in the order the agent should meet it: drift first
 * (a mirrored page telling customers something the team no longer believes is
 * the costliest of the three), then broken links, then unlinked notes.
 */
function scan(ctx: UseCaseContext): LibrarianFinding[] {
  const findings: LibrarianFinding[] = [];

  try {
    for (const pair of selectDriftPairs(ctx.index.all(), (t) => ctx.index.resolve(t))) {
      findings.push({ key: pair.key, kind: 'page-drift', revision: pair.revision, line: driftLine(pair) });
    }
  } catch (err) {
    // The tick never fails over stewardship, but a permanently broken pairing
    // must be diagnosable rather than indistinguishable from "no drift".
    logSweepError('[qale] librarian: drift pairing failed:', err instanceof Error ? err.message : err);
  }

  const report = getMaintenanceReport(ctx);

  if (report.danglingLinks.length > 0) {
    const pool = linkCandidatePool(ctx);
    const seen = new Set<string>();
    for (const link of report.danglingLinks) {
      const key = `librarian:link:${link.from} → ${link.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hints = suggestLinkCandidates(link.target, pool, HINTS_PER_LINK);
      const similar = hints.length > 0 ? ` Similar existing pages: ${hints.map((h) => h.slug).join(', ')}.` : '';
      findings.push({
        key,
        kind: 'broken-link',
        // The key already names the whole finding: same source, same target, same
        // problem, whatever else moved in the file around it.
        revision: '1',
        line: `- Broken link in ${link.from}: [[${link.target}]] resolves to nothing.${similar}`,
      });
    }
  }

  for (const orphan of report.orphans) {
    findings.push({
      key: `librarian:orphan:${orphan.path}`,
      // An edited note is a new finding: the PM may have been part-way through
      // writing it, and what it turned into deserves a fresh read.
      revision: String(ctx.index.get(orphan.path)?.mtime ?? 0),
      kind: 'unlinked-note',
      line: `- Unlinked note: "${orphan.title}" (${orphan.path}). Nothing links it and it links nothing.`,
    });
  }

  return findings;
}

function buildWorklist(findings: LibrarianFinding[], heldBack: number): string {
  const lines = [
    `The scan found ${plural(findings.length, 'thing', 'things')} that may need tidying. Read each one`,
    `before you decide anything, and raise only the repairs that are clearly worth the PM's attention.`,
    ``,
    ...findings.map((f) => f.line),
  ];
  if (findings.some((f) => f.line.includes('Similar existing pages:'))) {
    lines.push(
      ``,
      `The "similar existing pages" hints come from a fuzzy name match. They are a starting point for`,
      `your own search and they decide nothing.`,
    );
  }
  if (heldBack > 0) {
    lines.push(``, `${plural(heldBack, 'more finding is', 'more findings are')} waiting for the next pass.`);
  }
  return lines.join('\n');
}

/**
 * Scan, diff against the ledger, apply the settle and quiet windows, the
 * interval and the cap.
 * Returns null when there is nothing to hand over. Always writes the "first
 * seen" ledger rows, even when it returns null: that is what makes the settle
 * window work.
 */
export async function planLibrarianSweep(
  ctx: UseCaseContext,
  now: number,
  opts: LibrarianSweepOptions = {},
): Promise<LibrarianWork | null> {
  const checks = ctx.checks;
  // Without the ledger nothing settles and nothing stays handled, so every tick
  // would hand the agent the same worklist forever. Quietly not our tick.
  if (!checks) return null;
  const settleMs = opts.settleMs ?? DEFAULT_SETTLE_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const quietMs = opts.quietMs ?? DEFAULT_QUIET_MS;
  const cardCap = opts.cardCap ?? DEFAULT_CARD_CAP;
  const worklistMax = opts.worklistMax ?? DEFAULT_WORKLIST_MAX;

  const candidates: LibrarianFinding[] = [];
  for (const finding of scan(ctx)) {
    const row = parseRow(checks.get(finding.key));
    if (!row || row.revision !== finding.revision) {
      checks.set(finding.key, rowValue('seen', finding.revision, now), now);
      continue;
    }
    if (row.state === 'handled') {
      // A pre-agentic row carries no stamp of its own. Adopt it at this tick
      // rather than read it as handled in 1970, which would tip every pair the
      // workspace ever settled into the first worklist after an upgrade.
      if (row.stamp === 0) {
        checks.set(finding.key, rowValue('handled', finding.revision, now), now);
        continue;
      }
      // "Handled" is stamped the moment a session id comes back, before the
      // model has read a word, so it means handed over, not fixed. The agent may
      // have deliberately left this one for the next pass (its skill file tells
      // it to raise only a handful), the run may have died on a rate limit, or
      // the PM may have declined the card while the link is still broken. A
      // broken link's revision never changes either, so "handled for good" would
      // mean this workspace can never be told about that link again.
      //
      // So the row goes quiet rather than silent. For a week it keeps the
      // finding out of the way, which is what a declined card has earned, and
      // after that something genuinely still broken gets one more look.
      if (now - row.stamp < quietMs) continue;
      // Straight onto the list, no second settle wait: it held still through the
      // entire quiet window, which is all the settle window ever asks.
      candidates.push(finding);
      continue;
    }
    if (now - row.stamp < settleMs) continue;
    candidates.push(finding);
  }
  if (candidates.length === 0) return null;

  // A stamp we cannot read counts as no stamp: one session too many is a far
  // smaller problem than a librarian that never runs again.
  const lastRun = Number(checks.get(LAST_RUN_KEY));
  if (Number.isFinite(lastRun) && now - lastRun < intervalMs) return null;

  const pending = ctx.proposals.list('pending').filter((p) => p.skill === 'librarian').length;
  if (pending >= cardCap) {
    // Said out loud: a queue that stops draining stops the librarian entirely,
    // and "the tick does nothing" is otherwise indistinguishable from "tidy".
    logSweepError(
      `[qale] librarian: ${pending} cards already waiting (cap ${cardCap}), so no session this tick`,
    );
    return null;
  }

  const taken = candidates.slice(0, worklistMax);
  return { findings: taken, worklist: buildWorklist(taken, candidates.length - taken.length) };
}

/** Record that a session was handed these findings. Called only after it actually fired. */
export function markLibrarianHandled(
  ctx: UseCaseContext,
  findings: LibrarianFinding[],
  now: number,
): void {
  const checks = ctx.checks;
  if (!checks) return;
  for (const finding of findings) {
    checks.set(finding.key, rowValue('handled', finding.revision, now), now);
  }
}

/** Stamp the last librarian session, for the minimum interval. */
export function markLibrarianRun(ctx: UseCaseContext, now: number): void {
  ctx.checks?.set(LAST_RUN_KEY, String(now), now);
}
