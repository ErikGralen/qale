import {
  buildLinkRepairPatch,
  buildMentionLinkPatch,
  findUnlinkedMentions,
  suggestLinkCandidates,
  suggestLinkTarget,
  type LinkRepairCandidate,
  type UpdatePayload,
} from '@pm/domain';
import type {
  PingLinkChoiceItem,
  PingOrphanItem,
  PingPayload,
  PingRecord,
  UseCaseContext,
} from '../ports.js';
import { applyPatch, createProposal } from './proposals.js';
import { getMaintenanceReport, type MaintenanceReport } from './vault.js';

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
/** A dismissed finding or declined fix stays quiet for a week. */
const REDEDUPE_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many mention hosts offered per orphan. */
const MAX_MENTION_HOSTS = 3;

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
 * views that own them. Pending leftovers are retired on the next tick. */
const RETIRED_KEY = /^(overdue-todos$|meeting-prep-)/;

/** True when a patch block's search text is a wikilink on `target`. */
function searchesTarget(search: string, target: string): boolean {
  const head = `[[${target}`;
  if (!search.startsWith(head)) return false;
  const next = search.charAt(head.length);
  return next === ']' || next === '#' || next === '|';
}

/** The sweep's shared budget/dedupe view of existing librarian cards. */
interface FixLedger {
  pending: number;
  /** Librarian update cards that are pending or resolved within the dedupe window. */
  recent: { targetPath: string | null; patch: { search: string; replace: string }[] }[];
}

function readFixLedger(ctx: UseCaseContext, now: number): FixLedger {
  const librarian = ctx.proposals
    .list()
    .filter((p) => p.sessionId === 'librarian' && p.kind === 'update');
  return {
    pending: librarian.filter((p) => p.status === 'pending').length,
    recent: librarian
      .filter((p) => p.status === 'pending' || (p.resolved ?? 0) > now - REDEDUPE_MS)
      .map((p) => ({ targetPath: p.targetPath, patch: (p.payload as UpdatePayload).patch })),
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
    .filter((n) => !n.path.endsWith('/index.md'))
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
 * Orphan adoption options: for each unlinked note, find other notes that
 * mention its title as plain text (FTS-prefiltered — the sweep never reads the
 * whole vault). Each host becomes a one-tap "link it there"; orphans nothing
 * mentions stay skip-or-chat.
 */
async function collectOrphanItems(ctx: UseCaseContext, report: MaintenanceReport): Promise<PingOrphanItem[]> {
  const items: PingOrphanItem[] = [];
  for (const orphan of report.orphans) {
    const mentions: PingOrphanItem['mentions'] = [];
    if (orphan.title.trim().length >= 4) {
      for (const hit of ctx.index.search(orphan.title, 6)) {
        if (mentions.length >= MAX_MENTION_HOSTS) break;
        if (hit.path === orphan.path || hit.path.endsWith('/index.md')) continue;
        const note = await ctx.vault.readNote(hit.path);
        if (!note) continue;
        const lines = findUnlinkedMentions(note.body, orphan.title);
        if (lines.length === 0) continue;
        mentions.push({ host: hit.path, hostTitle: hit.title, line: lines[0]! });
      }
    }
    items.push({ id: orphan.path, path: orphan.path, title: orphan.title, mentions });
  }
  return items;
}

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
  const { fixes } = links;

  if (links.unfixed.length > 0) {
    const sample = links.unfixed.slice(0, 5);
    const items: PingLinkChoiceItem[] = links.unfixed.map((l) => ({
      id: `${l.from} → ${l.target}`,
      from: l.from,
      target: l.target,
      options: l.options,
    }));
    candidates.push({
      key: 'dangling-links',
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
  if (orphanItems.length >= 3) {
    const sample = orphanItems.slice(0, 5);
    candidates.push({
      key: 'orphans',
      title: `${orphanItems.length} notes have no links at all`,
      body: `Unlinked notes are invisible to the memory — nothing cites them, they cite nothing. Where they're already mentioned, one tap wires them in; the rest, chat or skip.`,
      evidence: sample.map((o) => ({ ref: `[[${o.path.replace(/\.md$/, '')}]]`, resolved: true })),
      sessionType: 'librarian',
      seedPrompt: `These notes are orphans (no inbound or outbound links):\n${orphanItems
        .map((o) => `- ${o.path} — ${o.title}`)
        .join('\n')}\n\nRead each one and propose where it belongs: link it into the relevant customer/problem/decision hubs, or say plainly that it's noise worth deleting.`,
      targetPath: null,
      payload: { kind: 'orphans', items: orphanItems },
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

export type PingResolveAction = { action: 'fix'; choice: string } | { action: 'skip' };

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
    if (!orphan.mentions.some((m) => m.host === host)) throw new Error(`not an offered host: ${host}`);
    const slug = orphan.path.replace(/\.md$/, '');
    await applyLibrarianPatch(ctx, host, (body) => buildMentionLinkPatch(body, orphan.title, slug), {
      missing: `“${orphan.title}” is no longer mentioned in ${host} — nothing to link.`,
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
  const written = await ctx.vault.writeNote(path, note.frontmatter, applied);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], msg.commit);
}
