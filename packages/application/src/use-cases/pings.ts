import {
  buildLinkRepairPatch,
  buildMentionLinkPatch,
  findUnlinkedMentions,
  isFolderIndex,
  suggestLinkCandidates,
  suggestLinkTarget,
  type LinkRepairCandidate,
  type NoteType,
  type UpdatePayload,
} from '@pm/domain';
import type {
  OrphanKind,
  PingLinkChoiceItem,
  PingOrphanItem,
  PingPayload,
  PingRecord,
  UseCaseContext,
} from '../ports.js';
import { applyPatch, createProposal } from './proposals.js';
import { getMaintenanceReport, type MaintenanceReport, type OrphanCandidate } from './vault.js';
import { REDEDUPE_MS, logSweepError, sweepWikipageDrift } from './wikipage-drift.js';

/**
 * The librarian sweep — the proactive half of "nothing silent". It works ahead:
 * every broken link with one confident target becomes a ready-made approval
 * card (diff, evidence — one click to fix, one to decline). Findings that need
 * a judgment call — ambiguous links, orphaned notes — become pings that carry
 * their own prepared answers: ranked "did you mean…?" choices and link-it-there
 * mentions the PO resolves with one tap, chat as the escape hatch.
 *
 * Scope: pings are workspace maintenance only. Time-anchored nudges live where
 * their subject lives — meeting prep on the meeting page, overdue commitments
 * in the Todos view — never as inbox pings.
 */

const MAX_PENDING_PINGS = 5;
/** Never queue more prepared fixes than a PO clears in one sitting. */
const MAX_PENDING_FIXES = 8;
// The quiet window (REDEDUPE_MS) is shared with the drift sweep — imported
// from wikipage-drift.ts so the two can't silently diverge.
/** At most this many mention hosts offered per orphan. */
const MAX_MENTION_HOSTS = 3;
/** Below this, a note naming other pages in prose is a coincidence, not a dump. */
const CAPTURE_NAME_FLOOR = 2;

interface Candidate {
  key: string;
  title: string;
  body: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  sessionType: string;
  seedPrompt: string;
  targetPath: string | null;
  payload?: PingPayload | null;
}

/** Ping kinds this sweep no longer produces — their nudges moved into the
 * views that own them, or (dangling-links/orphans) were superseded by the
 * payload-carrying suggestion pings, which live under NEW keys. The rename is
 * load-bearing: a lingering old-format ping (pending or recently dismissed)
 * would block its replacement via hasRecent for a week if the key were reused.
 * Leftovers are retired on the next tick. */
const RETIRED_KEY = /^(overdue-todos$|meeting-prep-|dangling-links$|orphans$|orphan-connect$)/;

/** True when a patch block's search text is a wikilink on `target`. */
function searchesTarget(search: string, target: string): boolean {
  const head = `[[${target}`;
  if (!search.startsWith(head)) return false;
  const next = search.charAt(head.length);
  return next === ']' || next === '#' || next === '|';
}

/** The sweep's shared budget/dedupe view of existing librarian cards. */
interface FixLedger {
  /** ALL pending librarian prepared fixes — link repairs AND page-drift cards
   * share the one queue the cap protects. */
  pending: number;
  /** Librarian update cards that are pending or resolved within the dedupe window. */
  recent: { targetPath: string | null; patch: { search: string; replace: string }[] }[];
}

function readFixLedger(ctx: UseCaseContext, now: number): FixLedger {
  const librarian = ctx.proposals
    .list()
    .filter((p) => p.sessionId === 'librarian' && (p.kind === 'update' || p.kind === 'outbound'));
  const updates = librarian.filter((p) => p.kind === 'update');
  return {
    pending: librarian.filter((p) => p.status === 'pending').length,
    recent: updates
      .filter((p) => p.status === 'pending' || (p.resolved ?? 0) > now - REDEDUPE_MS)
      .map((p) => ({ targetPath: p.targetPath, patch: (p.payload as UpdatePayload).patch ?? [] })),
  };
}

interface UnfixedLink {
  from: string;
  target: string;
  /** Ranked "did you mean…?" options — the one-tap choices on the ping. */
  options: LinkRepairCandidate[];
}

/**
 * Prepared link fixes: for each dangling link with exactly one confident
 * target, file an `update` card under the librarian's name. Declining is
 * remembered for a week; what can't be fixed confidently is returned for the
 * judgment-call ping, carrying its plausible targets.
 */
async function proposeLinkFixes(
  ctx: UseCaseContext,
  report: MaintenanceReport,
  ledger: FixLedger,
): Promise<{ fixes: number; unfixed: UnfixedLink[] }> {
  const alreadySuggested = (from: string, target: string): boolean =>
    ledger.recent.some(
      (p) => p.targetPath === from && p.patch.some((b) => searchesTarget(b.search, target)),
    );

  const candidates = ctx.index
    .all()
    .filter((n) => !isFolderIndex(n.path))
    .map((n) => ({ slug: n.slug, title: n.title }));

  const unfixed: UnfixedLink[] = [];
  const seen = new Set<string>();
  let fixes = 0;

  for (const link of report.danglingLinks) {
    const key = `${link.from} → ${link.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (alreadySuggested(link.from, link.target)) continue;
    const skip = (): void => {
      unfixed.push({ ...link, options: suggestLinkCandidates(link.target, candidates) });
    };
    if (ledger.pending >= MAX_PENDING_FIXES) {
      skip();
      continue;
    }
    const slug = suggestLinkTarget(link.target, candidates);
    const note = slug ? await ctx.vault.readNote(link.from) : null;
    const patch = slug && note ? buildLinkRepairPatch(note.body, link.target, slug) : [];
    if (!slug || !note || patch.length === 0) {
      // No confident target, or the link lives in frontmatter — needs judgment.
      skip();
      continue;
    }
    const rationale = `Repoint [[${link.target}]] at ${slug} — it currently resolves to nothing.`;
    createProposal(ctx, {
      kind: 'update',
      sessionId: 'librarian',
      sessionType: 'librarian',
      targetPath: link.from,
      // No baseHash: several fixes may share one file, and each earlier accept
      // would strand the rest as stale. The patch's search text is the real
      // staleness guard — if the broken link is gone, apply refuses cleanly.
      baseHash: null,
      payload: { path: link.from, patch, rationale } satisfies UpdatePayload,
      rationale,
      evidence: [{ ref: `[[${slug}]]`, resolved: true }],
      inference: false,
    });
    ledger.pending++;
    fixes++;
  }
  return { fixes, unfixed };
}

/**
 * Who already mentions this note in prose, as link-it-there options. Every
 * search term gets its own pass: a ticket is cited by its key ("chase PAY-5"),
 * never by its composed title, so hunting only the title finds nothing and
 * reports "nothing mentions it" — technically true, materially wrong.
 */
async function findMentionHosts(
  ctx: UseCaseContext,
  orphan: OrphanCandidate,
): Promise<PingOrphanItem['mentions']> {
  const mentions: PingOrphanItem['mentions'] = [];
  const seen = new Set<string>();
  for (const term of [orphan.title, ...orphan.aliases]) {
    if (term.trim().length < 4) continue;
    for (const hit of ctx.index.search(term, 6)) {
      if (mentions.length >= MAX_MENTION_HOSTS) return mentions;
      if (hit.path === orphan.path || isFolderIndex(hit.path) || seen.has(hit.path)) continue;
      const note = await ctx.vault.readNote(hit.path);
      if (!note) continue;
      const lines = findUnlinkedMentions(note.body, term);
      if (lines.length === 0) continue;
      seen.add(hit.path);
      mentions.push({ host: hit.path, hostTitle: hit.title, line: lines[0]!, term });
    }
  }
  return mentions;
}

/**
 * Note types titled with a proper name, which prose shortens ("Kranelund
 * Logistics" → "kranelund"). Deliberately excludes themes: their titles are
 * descriptive phrases, so a leading word like "Scheduled" or "Mobile" is a
 * common adjective, not a name, and matching on it would invent references.
 */
const PROPER_NAME_TYPES = new Set<NoteType>(['person', 'customer']);

interface NameKey {
  path: string;
  slug: string;
  title: string;
  /** The literal text to hunt for — a full title, or a hub's first name. */
  key: string;
}

/**
 * The vocabulary a dump would plausibly use for each existing page. Full titles
 * count, but nobody writing at speed types them: the vault knows "Kranelund
 * Logistics" and "Sara Lindqvist" while the scratch pad says "kranelund" and
 * "sara". So a proper-name page also contributes its leading word, and only
 * when that word is unambiguous across the whole vocabulary. A short name two
 * pages could claim buys nothing here and would misattribute the evidence.
 */
function buildNameKeys(pool: OrphanScanPool): NameKey[] {
  const keys: NameKey[] = [];
  for (const n of pool) {
    const title = n.title.trim();
    if (title.length >= 4) keys.push({ ...n, key: title });
    const first = title.split(/[\s·—-]+/)[0]?.trim() ?? '';
    if (PROPER_NAME_TYPES.has(n.type) && first.length >= 4 && first !== title) {
      keys.push({ ...n, key: first });
    }
  }
  const byKey = new Map<string, NameKey[]>();
  for (const k of keys) {
    const lower = k.key.toLowerCase();
    byKey.set(lower, [...(byKey.get(lower) ?? []), k]);
  }
  return keys.filter((k) => (byKey.get(k.key.toLowerCase()) ?? []).every((o) => o.path === k.path));
}

/**
 * The reverse direction: existing pages THIS note names in prose without
 * linking. A scratch pad naming half the vault isn't a hygiene defect, it's the
 * densest unabsorbed signal in the workspace — and it's what tells a dump apart
 * from a page nobody ever cited. The lowercase-substring prefilter is exactly
 * equivalent to the (case-insensitive, literal) mention regex, so it skips the
 * work without changing the answer.
 */
function findNamedPages(body: string, orphanPath: string, keys: NameKey[]): { slug: string; title: string }[] {
  const haystack = body.toLowerCase();
  const names = new Map<string, { slug: string; title: string }>();
  for (const cand of keys) {
    if (cand.path === orphanPath || names.has(cand.path)) continue;
    if (!haystack.includes(cand.key.toLowerCase())) continue;
    if (findUnlinkedMentions(body, cand.key).length === 0) continue;
    names.set(cand.path, { slug: cand.slug, title: cand.title });
  }
  return [...names.values()];
}

type OrphanScanPool = { path: string; slug: string; title: string; type: NoteType }[];

/**
 * Turn each unlinked note into an item that carries its own right answer. The
 * kind is decided here rather than in the index scan because telling a dump
 * from a stray page needs the body: a note that names pages it never links is
 * capture waiting to be processed, whatever its frontmatter claims.
 */
async function collectOrphanItems(ctx: UseCaseContext, report: MaintenanceReport): Promise<PingOrphanItem[]> {
  const pool: OrphanScanPool = ctx.index
    .all()
    .filter((n) => !isFolderIndex(n.path) && n.type !== 'skill')
    .map((n) => ({ path: n.path, slug: n.slug, title: n.title, type: n.type }));
  const nameKeys = buildNameKeys(pool);

  const items: PingOrphanItem[] = [];
  for (const orphan of report.orphans) {
    const mentions = await findMentionHosts(ctx, orphan);
    const note = orphan.external ? null : await ctx.vault.readNote(orphan.path);
    const names = note ? findNamedPages(note.body, orphan.path, nameKeys) : [];
    const kind: OrphanKind = orphan.external
      ? 'external'
      : names.length >= CAPTURE_NAME_FLOOR
        ? 'capture'
        : 'stray';
    items.push({
      id: orphan.path,
      path: orphan.path,
      title: orphan.title,
      kind,
      detail: orphan.detail,
      mentions,
      ...(names.length > 0 ? { names } : {}),
    });
  }
  // Ready answers lead: orphans someone already mentions come first, so the
  // one-tap rows aren't buried under a wall of "nothing mentions it".
  return items.sort((a, b) => b.mentions.length - a.mentions.length);
}

/**
 * One finding per cause. Splitting is the point: "4 notes have no links at all"
 * names a symptom nobody can act on, and forces one action vocabulary onto
 * three unrelated situations. Each group states its own cause, carries its own
 * answers, and seeds its own conversation.
 */
interface OrphanGroup {
  kind: OrphanKind;
  key: string;
  /** Below this many items the finding isn't worth a card of its own. */
  floor: number;
  title: (items: PingOrphanItem[]) => string;
  body: string;
  seed: (items: PingOrphanItem[]) => string;
}

/** "1 ticket" / "3 tickets" — the noun the group is actually about. */
function countOf(items: PingOrphanItem[], one: string, many: string): string {
  return `${items.length} ${items.length === 1 ? one : many}`;
}

const ORPHAN_GROUPS: OrphanGroup[] = [
  {
    kind: 'external',
    key: 'unconnected-mirrors',
    floor: 2,
    title: (items) => {
      const noun = items.every((i) => i.path.startsWith('tickets/'))
        ? ['open ticket', 'open tickets']
        : ['tracked item', 'tracked items'];
      return `${countOf(items, noun[0]!, noun[1]!)} aren't linked from anywhere in the workspace`;
    },
    body: `These mirror records live in another system — the workspace can't delete them, only say what they serve. Right now nothing here points at them at all.`,
    seed: (items) =>
      `These tracked items are still open upstream, and nothing in the workspace links them:\n${items
        .map((i) => `- ${i.path} — ${i.title}${i.detail ? ` (${i.detail})` : ''}`)
        .join('\n')}\n\nRead each one and work out what it serves, then propose the link from whatever page actually explains it — a theme, a customer, a meeting, a decision. The link goes in that page, never in the mirror itself (those are re-synced wholesale and local edits are lost). A ticket does not need a hub to be legitimate: where a piece of work plainly stands on its own, say so and leave it rather than inventing a parent for it. Where you genuinely can't tell what an item is for, ask.`,
  },
  {
    kind: 'capture',
    key: 'unprocessed-captures',
    floor: 1,
    title: (items) => `${countOf(items, 'capture note', 'capture notes')} waiting to be processed`,
    body: `Raw jottings naming people, customers and themes that were never wired in. Processing turns those names into links, commitments into todos, and claims into insights.`,
    seed: (items) =>
      `These notes are raw captures — they name pages that exist without linking any of them:\n${items
        .map((i) => `- ${i.path} — ${i.title}${i.names?.length ? ` (names: ${i.names.map((n) => n.slug).join(', ')})` : ''}`)
        .join('\n')}\n\nRun the Process-Note pass over each: propose one update per note cleaning it up and turning plain-text mentions into wikilinks, updates to the hubs it adds signal to, and the todos, insights or decisions it implies. Nothing invented — every card cites the note.`,
  },
  {
    kind: 'stray',
    key: 'stray-notes',
    floor: 3,
    title: (items) => `${countOf(items, 'note has', 'notes have')} no links at all`,
    body: `Unlinked notes are invisible to the memory — nothing cites them, they cite nothing. Where they're already mentioned, one tap wires them in; the rest, chat or skip.`,
    seed: (items) =>
      `These notes are orphans (no inbound or outbound links):\n${items
        .map((i) => `- ${i.path} — ${i.title}`)
        .join('\n')}\n\nRead each one and propose where it belongs: link it into the relevant customer/theme/decision hubs, or say plainly that it's noise worth deleting.`,
  },
];

/**
 * The librarian's maintenance pass: prepared fixes first (approval cards),
 * then at most a handful of judgment-call pings for what's left, each carrying
 * its one-tap suggestions. Idempotent — fixes and findings dedupe against
 * pending and recently-declined work.
 */
export async function runLibrarianSweep(ctx: UseCaseContext): Promise<{ pings: number; fixes: number }> {
  const pings = ctx.pings;
  if (!pings) return { pings: 0, fixes: 0 };
  const now = Date.parse(ctx.clock.now());
  const candidates: Candidate[] = [];

  for (const p of pings.list('pending')) {
    if (RETIRED_KEY.test(p.key)) pings.setStatus(p.id, 'dismissed', now);
  }

  const report = getMaintenanceReport(ctx);
  const ledger = readFixLedger(ctx, now);
  const links = await proposeLinkFixes(ctx, report, ledger);
  let { fixes } = links;

  // Wikipage stewardship: the decision spine vs. deep-tracked mirror pages.
  // Confident, localizable contradictions land as redline update_page cards
  // (sharing the prepared-fix budget); diffuse ones queue as judgment-call
  // pings below. Best-effort like everything else in the tick.
  try {
    // Drift candidates are pushed FIRST (before link/orphan pings below), so
    // the slots handed to the sweep are exactly the ones its findings will
    // consume in the creation loop — a capped finding defers unrecorded.
    const pingBudget = { slots: Math.max(0, MAX_PENDING_PINGS - pings.pendingCount()) };
    const drift = await sweepWikipageDrift(ctx, ledger, MAX_PENDING_FIXES, now, pingBudget);
    fixes += drift.fixes;
    candidates.push(...drift.candidates);
  } catch (err) {
    // The sweep never fails over stewardship — but a permanently-broken tick
    // must be diagnosable, not indistinguishable from "no drift".
    logSweepError('[pm] wikipage stewardship sweep failed:', err instanceof Error ? err.message : err);
  }

  if (links.unfixed.length > 0) {
    const sample = links.unfixed.slice(0, 5);
    const items: PingLinkChoiceItem[] = links.unfixed.map((l) => ({
      id: `${l.from} → ${l.target}`,
      from: l.from,
      target: l.target,
      options: l.options,
    }));
    candidates.push({
      key: 'link-choices',
      title: `${links.unfixed.length} broken link${links.unfixed.length === 1 ? '' : 's'} need${links.unfixed.length === 1 ? 's' : ''} a judgment call`,
      body: `The librarian couldn't pick a single confident target for these, so it won't guess — pick the right one, or chat it through.`,
      evidence: sample.map((l) => ({ ref: `[[${l.from.replace(/\.md$/, '')}]]`, resolved: true })),
      sessionType: 'librarian',
      seedPrompt: `These wikilinks don't resolve, and no single existing note is a confident match:\n${links.unfixed
        .map(
          (l) =>
            `- ${l.from} → [[${l.target}]]${
              l.options.length > 0 ? ` (plausible: ${l.options.map((o) => o.slug).join(', ')})` : ''
            }`,
        )
        .join('\n')}\n\nFor each one: confirm the intended target with me (start from the plausible candidates, search the vault where there are none), then propose an update fixing the link. If the target truly doesn't exist, say so and suggest whether to create it or drop the link.`,
      targetPath: null,
      payload: { kind: 'link-choices', items },
    });
  }

  const orphanItems = await collectOrphanItems(ctx, report);
  for (const group of ORPHAN_GROUPS) {
    const items = orphanItems.filter((o) => o.kind === group.kind);
    if (items.length < group.floor) continue;
    candidates.push({
      key: group.key,
      title: group.title(items),
      body: group.body,
      evidence: items.slice(0, 5).map((o) => ({ ref: `[[${o.path.replace(/\.md$/, '')}]]`, resolved: true })),
      sessionType: 'librarian',
      seedPrompt: group.seed(items),
      targetPath: null,
      payload: { kind: 'orphans', items },
    });
  }

  let created = 0;
  for (const c of candidates) {
    if (pings.pendingCount() >= MAX_PENDING_PINGS) break;
    if (pings.hasRecent(c.key, now - REDEDUPE_MS)) continue;
    pings.create(c, now);
    created++;
  }
  return { pings: created, fixes };
}

export function listPings(ctx: UseCaseContext, status = 'pending'): PingRecord[] {
  return ctx.pings?.list(status) ?? [];
}

/** Mark a ping taken — the caller opens the seeded session. */
export function openPing(ctx: UseCaseContext, id: string): PingRecord | null {
  const ping = ctx.pings?.get(id) ?? null;
  if (!ping || !ctx.pings) return null;
  ctx.pings.setStatus(id, 'opened', Date.parse(ctx.clock.now()));
  return { ...ping, status: 'opened' };
}

export function dismissPing(ctx: UseCaseContext, id: string): void {
  ctx.pings?.setStatus(id, 'dismissed', Date.parse(ctx.clock.now()));
}

export type PingResolveAction =
  | { action: 'fix'; choice: string }
  | { action: 'skip' }
  /** The PO took this item into a Process-Note session — record the handoff so
   *  the card can retire; the session does the actual work as approval cards. */
  | { action: 'process' };

/**
 * Resolve one suggestion item on a ping — the tap IS the approval. A fix
 * applies the prepared patch (write, reindex, path-scoped commit) exactly like
 * accepting a card; a skip just records the judgment. The ping retires when
 * every item is resolved. Throws with a readable message when the workspace
 * moved under the suggestion — nothing is half-applied.
 */
export async function resolvePingItem(
  ctx: UseCaseContext,
  pingId: string,
  itemId: string,
  action: PingResolveAction,
): Promise<PingRecord | null> {
  const pings = ctx.pings;
  const ping = pings?.get(pingId) ?? null;
  if (!pings || !ping || !ping.payload || ping.status !== 'pending') return ping;

  // JSON round-trip clone — the payload is plain data from the store.
  const payload = JSON.parse(JSON.stringify(ping.payload)) as PingPayload;
  const item = payload.items.find((i) => i.id === itemId) as
    | PingLinkChoiceItem
    | PingOrphanItem
    | undefined;
  if (!item || item.resolution) return ping;

  if (action.action === 'skip') {
    item.resolution = { action: 'skipped' };
  } else if (action.action === 'process') {
    if (payload.kind !== 'orphans') throw new Error('only an unlinked note can be processed');
    (item as PingOrphanItem).resolution = { action: 'processing' };
  } else if (payload.kind === 'link-choices') {
    const link = item as PingLinkChoiceItem;
    const slug = action.choice;
    if (!link.options.some((o) => o.slug === slug)) throw new Error(`not an offered target: ${slug}`);
    await applyLibrarianPatch(ctx, link.from, (body) => buildLinkRepairPatch(body, link.target, slug), {
      missing: `The link [[${link.target}]] is no longer in ${link.from} — nothing to fix.`,
      commit: `librarian: repoint [[${link.target}]] → ${slug}`,
    });
    link.resolution = { action: 'fixed', slug };
  } else {
    const orphan = item as PingOrphanItem;
    const host = action.choice;
    const mention = orphan.mentions.find((m) => m.host === host);
    if (!mention) throw new Error(`not an offered host: ${host}`);
    const slug = orphan.path.replace(/\.md$/, '');
    // The term that actually matched — a ticket is cited by its key, not its
    // title. Pings written before terms were recorded fall back to the title.
    const term = mention.term ?? orphan.title;
    await applyLibrarianPatch(ctx, host, (body) => buildMentionLinkPatch(body, term, slug), {
      missing: `“${term}” is no longer mentioned in ${host} — nothing to link.`,
      commit: `librarian: link ${slug} into ${host}`,
    });
    orphan.resolution = { action: 'fixed', host };
  }

  pings.updatePayload(pingId, payload);
  const allDone = payload.items.every((i) => i.resolution);
  if (allDone) pings.setStatus(pingId, 'resolved', Date.parse(ctx.clock.now()));
  return pings.get(pingId);
}

/** Apply a librarian-built patch to one note: write, reindex, scoped commit. */
async function applyLibrarianPatch(
  ctx: UseCaseContext,
  path: string,
  build: (body: string) => { search: string; replace: string }[],
  msg: { missing: string; commit: string },
): Promise<void> {
  const note = await ctx.vault.readNote(path);
  if (!note) throw new Error(`${path} no longer exists.`);
  const patch = build(note.body);
  const applied = patch.length > 0 ? applyPatch(note.body, patch) : null;
  if (applied === null) throw new Error(msg.missing);
  const written = await ctx.vault.writeBody(path, applied);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], msg.commit);
}
