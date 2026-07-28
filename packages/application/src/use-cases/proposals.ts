import {
  zNotePayload,
  zUpdatePayload,
  zDecisionPayload,
  zOutboundPayload,
  parseFrontmatter,
  checkSupersede,
  checkFrontmatterMutation,
  isBodyEditable,
  refToSlug,
  type DecisionNode,
  type DecisionFrontmatter,
  type Frontmatter,
  type OutboundPayload,
} from '@pm/domain';
import type { CreateProposalInput, ProposalRecord, ProposalStats, UseCaseContext } from '../ports.js';
import { renameNote } from './notes.js';

/**
 * Proposals (approval cards) are the only write path for the agent (PLAN-V2 §3.3).
 * Tools persist card rows here; the Inbox applies accepted ones through these use
 * cases, which write files + git-commit. Accept is staleness-safe via base_hash;
 * decisions supersede rather than overwrite.
 */

/** This package has no runtime types (pure by design) — log through globalThis
 *  so best-effort failure paths are diagnosable without importing a platform. */
export const logError = (...args: unknown[]): void => {
  (globalThis as { console?: { error?: (...a: unknown[]) => void } }).console?.error?.(...args);
};

/** Cheap, stable content hash for staleness detection (no node dep). */
export function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function createProposal(ctx: UseCaseContext, input: CreateProposalInput): ProposalRecord {
  return ctx.proposals.create(input, Date.now());
}

export function listProposals(ctx: UseCaseContext, status?: string): ProposalRecord[] {
  return ctx.proposals.list(status);
}

/** Card telemetry — approval rate + time-to-approve (the kill-criteria metric). */
export function getProposalStats(ctx: UseCaseContext): ProposalStats {
  return ctx.proposals.stats();
}

export interface ProposalPreview {
  before: string;
  after: string;
  stale: boolean;
  /**
   * Why an update is stale, so the card can speak honestly instead of always
   * blaming a change that may not have happened:
   *  - `changed`    — the note really was edited since the card was proposed
   *                   (base hash differs, or the target was deleted).
   *  - `unanchored` — the note is unchanged but the patch's search text can't be
   *                   located, so there's nothing to apply.
   */
  staleReason?: 'changed' | 'unanchored';
  /**
   * Frontmatter keys this update changes, so the card can SHOW a metadata edit
   * (a todo's due/status) — the body diff deliberately hides frontmatter, so a
   * pure-frontmatter card would otherwise preview as blank.
   */
  frontmatterChanges?: { key: string; before: unknown; after: unknown }[];
}

/** The frontmatter keys an update card actually changes (shallow diff of the merge). */
function frontmatterDiff(
  current: Record<string, unknown>,
  changes: Record<string, unknown> | undefined,
): { key: string; before: unknown; after: unknown }[] {
  if (!changes) return [];
  const out: { key: string; before: unknown; after: unknown }[] = [];
  for (const [key, after] of Object.entries(changes)) {
    const before = current[key];
    if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ key, before, after });
  }
  return out;
}

/** Compute the review-time diff for a proposal against CURRENT file content. */
export async function previewProposal(ctx: UseCaseContext, id: string): Promise<ProposalPreview | null> {
  const rec = ctx.proposals.get(id);
  if (!rec) return null;
  if (rec.kind === 'note' || rec.kind === 'decision' || rec.kind === 'outbound') {
    const payload = rec.payload as { body?: string };
    return { before: '', after: payload.body ?? '', stale: false };
  }
  if (rec.kind === 'update') {
    const payload = rec.payload as {
      path: string;
      patch?: { search: string; replace: string }[];
      frontmatter?: Record<string, unknown>;
    };
    const note = await ctx.vault.readNote(payload.path);
    if (!note) return { before: '', after: '', stale: true, staleReason: 'changed' };
    const changed = !!rec.baseHash && contentHash(note.body) !== rec.baseHash;
    const patch = payload.patch ?? [];
    // No body patch (frontmatter-only) → nothing to anchor; the body stands as-is.
    const applied = patch.length > 0 ? applyPatch(note.body, patch) : note.body;
    const stale = changed || applied === null;
    return {
      before: note.body,
      after: applied ?? note.body,
      stale,
      // A missed anchor on an unchanged note is an anchoring failure, not drift.
      staleReason: stale ? (changed ? 'changed' : 'unanchored') : undefined,
      frontmatterChanges: frontmatterDiff(note.frontmatter as Record<string, unknown>, payload.frontmatter),
    };
  }
  return null;
}

export function rejectProposal(ctx: UseCaseContext, id: string): { ok: boolean } {
  const rec = ctx.proposals.get(id);
  if (!rec || rec.status !== 'pending') return { ok: false };
  ctx.proposals.setStatus(id, 'rejected', Date.now());
  return { ok: true };
}

export interface AcceptResult {
  ok: boolean;
  stale?: boolean;
  error?: string;
  /** Deterministic link produced by an outbound write, if any. */
  url?: string;
}

/**
 * Accepts currently in flight. The pending-status check alone can't stop a
 * double-click / retry race: both invokes read `pending` before either awaits
 * the (slow, external) write. The claim below is synchronous, so the second
 * invoke bounces before anything fires twice.
 */
const acceptsInFlight = new Set<string>();

/** Apply an accepted proposal to the workspace, dispatching by kind. */
export async function acceptProposal(
  ctx: UseCaseContext,
  id: string,
  edited?: unknown,
): Promise<AcceptResult> {
  const rec = ctx.proposals.get(id);
  if (!rec || rec.status !== 'pending') return { ok: false };
  if (acceptsInFlight.has(id)) return { ok: false, error: 'already being applied' };
  acceptsInFlight.add(id);

  try {
    let result: AcceptResult;
    if (rec.kind === 'note') result = await acceptNote(ctx, rec, edited);
    else if (rec.kind === 'update') result = await acceptUpdate(ctx, rec, edited);
    else if (rec.kind === 'decision') result = await acceptDecision(ctx, rec, edited);
    else if (rec.kind === 'outbound') result = await acceptOutbound(ctx, rec, edited);
    else return { ok: false };

    // Telemetry: record how far the human edited the card before approving.
    if (result.ok && edited !== undefined) {
      ctx.proposals.markEdited(id);
    }
    return result;
  } finally {
    acceptsInFlight.delete(id);
  }
}

async function acceptNote(ctx: UseCaseContext, rec: ProposalRecord, edited?: unknown): Promise<AcceptResult> {
  const parsed = zNotePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid note payload' };
  const { path, frontmatter, body } = parsed.data;
  const fm = parseFrontmatter(frontmatter);
  if (!fm.ok || !fm.data) return { ok: false, error: fm.error };
  // A `note` card means a NEW note; the preview shows `before: ''`, so an
  // overwrite here would clobber an existing file sight-unseen.
  if (await ctx.vault.exists(path)) {
    return { ok: false, error: `a note already exists at ${path} — propose an update to it instead` };
  }
  const written = await ctx.vault.writeNote(path, fm.data, body);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], `note: ${written.slug}`);
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  await markCitedSourcesProcessed(ctx, fm.data);
  return { ok: true };
}

/**
 * When an approved derived note cites raw material (`evidence`/`sources` refs),
 * the analysis has landed: flip cited sources and unprocessed meetings from
 * `new`/`stale` to `processed`. Best-effort — a bad ref never blocks the accept.
 */
async function markCitedSourcesProcessed(ctx: UseCaseContext, fm: Frontmatter): Promise<void> {
  const rec = fm as Record<string, unknown>;
  const refs = [
    ...(Array.isArray(rec['evidence']) ? (rec['evidence'] as string[]) : []),
    ...(Array.isArray(rec['sources']) ? (rec['sources'] as string[]) : []),
  ];
  for (const ref of refs) {
    const slug = refToSlug(ref);
    if (!slug) continue;
    const path = ctx.index.resolve(slug);
    const indexed = path ? ctx.index.get(path) : null;
    if (!indexed || !path) continue;
    if (indexed.type !== 'source' && indexed.type !== 'meeting') continue;
    const status = (indexed.frontmatter as Record<string, unknown>)['status'];
    if (status !== 'new' && status !== 'stale') continue;
    const note = await ctx.vault.readNote(path);
    if (!note) continue;
    const written = await ctx.vault.writeNote(
      path,
      { ...note.frontmatter, status: 'processed' } as Frontmatter,
      note.body,
    );
    ctx.index.reindex(written);
    await ctx.git.commitPaths([path], `status: ${written.slug} → processed`);
  }
}

async function acceptUpdate(ctx: UseCaseContext, rec: ProposalRecord, edited?: unknown): Promise<AcceptResult> {
  const parsed = zUpdatePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid update payload' };
  const { path, patch, frontmatter, title } = parsed.data;
  const note = await ctx.vault.readNote(path);
  if (!note) return { ok: false, error: 'target not found' };
  // Staleness: the target may have been edited in Obsidian since the proposal.
  if (rec.baseHash && contentHash(note.body) !== rec.baseHash) {
    ctx.proposals.setStatus(rec.id, 'stale', Date.now());
    return { ok: false, stale: true };
  }
  // The same invariants saveFrontmatter/saveAuthoredNote enforce apply to
  // cards: an update card must not patch an immutable raw-layer body, and its
  // frontmatter merge must not rewrite protected fields (a mirror's identity,
  // a decision's spine) — a card is a write path, not a side door.
  if (patch && patch.length > 0 && !isBodyEditable(note.type)) {
    return { ok: false, error: `the body of a ${note.type} note can't be edited — it only changes on re-sync` };
  }
  // A frontmatter-only card carries no patch — the body stands as-is.
  const applied = patch && patch.length > 0 ? applyPatch(note.body, patch) : note.body;
  if (applied === null) {
    ctx.proposals.setStatus(rec.id, 'stale', Date.now());
    return { ok: false, stale: true };
  }
  // Shallow-merge any frontmatter changes (reschedule a due date, close a todo)
  // over the note's current metadata — the only card path that edits frontmatter.
  const nextFm = frontmatter
    ? ({ ...note.frontmatter, ...frontmatter } as typeof note.frontmatter)
    : note.frontmatter;
  if (frontmatter) {
    const check = checkFrontmatterMutation(note.type, note.frontmatter, nextFm);
    if (!check.allowed) return { ok: false, error: check.reason };
  }
  const written = frontmatter
    ? await ctx.vault.writeNote(path, nextFm, applied)
    : await ctx.vault.writeBody(path, applied);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], `update: ${written.slug}`);
  if (title?.trim()) {
    // Best-effort: an immutable-title type refuses the rename, but the body
    // change above already landed — the card must not fail over its garnish.
    try {
      await renameNote(ctx, { path, title });
    } catch {
      /* body update stands; title stays */
    }
  }
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  return { ok: true };
}

/**
 * Accept a decision card: write the new decision (append-only spine) and, when it
 * supersedes an existing one, flip the old file's status + set the forward pointer
 * — never editing the old body. Cycle/lineage guarded (PLAN-V2 §5.6).
 */
async function acceptDecision(ctx: UseCaseContext, rec: ProposalRecord, edited?: unknown): Promise<AcceptResult> {
  const parsed = zDecisionPayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid decision payload' };
  const { path, frontmatter, body, supersedes } = parsed.data;
  const fm = parseFrontmatter({ ...frontmatter, type: 'decision' });
  if (!fm.ok || !fm.data) return { ok: false, error: fm.error };

  const newSlug = path.replace(/\.md$/, '');
  const resolveDecision = (slug: string): DecisionNode | null => {
    const p = ctx.index.resolve(slug);
    const rc = p ? ctx.index.get(p) : null;
    if (!rc || rc.type !== 'decision') return null;
    return { slug: rc.slug, frontmatter: rc.frontmatter as unknown as DecisionFrontmatter };
  };

  // Same new-note contract as note cards: the preview never shows what an
  // overwrite would destroy, so refuse to clobber an existing file. Checked
  // BEFORE the supersede flip — a later refusal would leave the old decision
  // half-flipped.
  if (await ctx.vault.exists(path)) {
    return { ok: false, error: `a note already exists at ${path} — propose a supersede or update instead` };
  }

  const committed: string[] = [];
  const targetSlug = refToSlug(supersedes);
  let newFm = fm.data as Frontmatter;

  if (targetSlug) {
    const check = checkSupersede(newSlug, targetSlug, resolveDecision);
    if (!check.allowed) return { ok: false, error: check.reason };
    const targetPath = ctx.index.resolve(targetSlug);
    const target = targetPath ? await ctx.vault.readNote(targetPath) : null;
    if (!target || !targetPath) return { ok: false, error: `supersede target not found: ${targetSlug}` };
    // Flip the old decision: status → superseded, forward pointer set. Body frozen.
    const oldFm = {
      ...target.frontmatter,
      status: 'superseded',
      superseded_by: `[[${newSlug}]]`,
    } as Frontmatter;
    const writtenOld = await ctx.vault.writeNote(targetPath, oldFm, target.body);
    ctx.index.reindex(writtenOld);
    committed.push(targetPath);
    newFm = { ...newFm, supersedes: `[[${targetSlug}]]` } as Frontmatter;
  }

  const written = await ctx.vault.writeNote(path, newFm, body);
  ctx.index.reindex(written);
  committed.push(path);
  await ctx.git.commitPaths(committed, `decision: ${written.slug}${targetSlug ? ` (supersedes ${targetSlug})` : ''}`);
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  await markCitedSourcesProcessed(ctx, newFm);
  return { ok: true };
}

/**
 * Accept an outbound card (PLAN-V2 §3.4): write to Jira/Confluence via the
 * outbound port on approval, never before. On failure the card stays pending (it
 * returns to the Inbox with the error — nothing half-applied). The deterministic
 * link is appended to the workspace note that spawned it.
 */
async function acceptOutbound(ctx: UseCaseContext, rec: ProposalRecord, edited?: unknown): Promise<AcceptResult> {
  const parsed = zOutboundPayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid outbound payload' };
  const p: OutboundPayload = parsed.data;

  // 'message' drafts (CS/sales/exec notes) are saved to the workspace, not sent —
  // Slack/Teams/email are out of scope until MVP2 (the card model already fits).
  if (p.provider === 'message') {
    const dateLine = `> Draft for ${p.audience ?? 'stakeholders'} — ${ctx.clock.now().slice(0, 10)}\n\n`;
    if (!p.linkBackPath) return { ok: false, error: 'no note to save this draft to — the card has no link-back path' };
    const note = await ctx.vault.readNote(p.linkBackPath);
    if (!note) return { ok: false, error: `can't save the draft — ${p.linkBackPath} no longer exists` };
    const next = `${note.body.trimEnd()}\n\n## Draft: ${p.title ?? p.audience ?? 'update'}\n${dateLine}${p.body}\n`;
    const written = await ctx.vault.writeBody(p.linkBackPath, next);
    ctx.index.reindex(written);
    await ctx.git.commitPaths([p.linkBackPath], `draft: ${p.audience ?? 'message'}`);
    ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
    return { ok: true };
  }

  if (!ctx.outbound) return { ok: false, error: 'no outbound integration configured (set Atlassian in Settings)' };

  // Drafted-against-stale: the card snapshotted the mirror's `remote_updated`
  // (and `version` for pages) at draft time. If the mirror has since re-synced
  // to something newer, refuse — the card stays PENDING (not flipped stale):
  // the PM re-approves after a glance, with the refreshed snapshot on the
  // edited payload, instead of losing the draft.
  const mirror = findOutboundMirror(ctx, p);
  if (mirror) {
    const fm = mirror.frontmatter as Record<string, unknown>;
    const changedSince =
      (p.remote_updated && typeof fm['remote_updated'] === 'string' && fm['remote_updated'] !== p.remote_updated) ||
      (p.version !== undefined && typeof fm['version'] === 'number' && fm['version'] !== p.version);
    if (changedSince) {
      return {
        ok: false,
        stale: true,
        error: `${p.issueKey ?? mirror.title} changed since this was drafted — review the change, then approve again to send anyway`,
      };
    }
  }

  // ONE dispatch site: the connector re-validates the payload and routes by
  // provider/action; this layer never learns provider API shapes.
  let out: { externalId: string; url: string };
  try {
    out = await ctx.outbound.execute(p);
  } catch (err) {
    // Fail the card gracefully — it stays pending, nothing half-applied.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // The external write LANDED: record acceptance before any local garnish, so
  // a link-back failure can't leave the card pending and invite a double-post.
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());

  // Link-back: append the deterministic API link (the created key, e.g.
  // "PAY-171") to the spawning note. Best-effort — the push already happened.
  if (p.linkBackPath) {
    try {
      const note = await ctx.vault.readNote(p.linkBackPath);
      if (note) {
        const line = `- ${p.provider}: [${out.externalId}](${out.url})`;
        const next = /## Pushed/.test(note.body)
          ? note.body.replace(/## Pushed\n/, `## Pushed\n${line}\n`)
          : `${note.body.trimEnd()}\n\n## Pushed\n${line}\n`;
        const written = await ctx.vault.writeNote(p.linkBackPath, note.frontmatter, next);
        ctx.index.reindex(written);
        await ctx.git.commitPaths([p.linkBackPath], `pushed: ${p.provider} → ${p.linkBackPath}`);
      }
    } catch (err) {
      logError('[pm] outbound link-back failed (push already landed):', err instanceof Error ? err.message : err);
    }
  }

  return { ok: true, url: out.url };
}

/**
 * The mirror note an outbound card writes AGAINST (comment target, page being
 * edited) — resolved by external id, since mirror slugs are name-based. Null
 * for create actions and un-mirrored targets: no snapshot, nothing to compare.
 */
function findOutboundMirror(
  ctx: UseCaseContext,
  p: OutboundPayload,
): { title: string; frontmatter: Record<string, unknown> } | null {
  // The mirror carrying the drafted-against snapshot: a wikipage for page edits,
  // the synced meeting note for calendar reschedules/RSVPs, else the ticket.
  // create_* actions have no prior mirror — wanted stays undefined → no compare.
  const [type, wanted]: readonly ['wikipage' | 'ticket' | 'meeting', string | undefined] =
    p.action === 'update_page'
      ? (['wikipage', p.pageId] as const)
      : p.action === 'update_event' || p.action === 'respond_to_event'
        ? (['meeting', p.eventId] as const)
        : (['ticket', p.issueKey] as const);
  if (!wanted) return null;
  return (
    ctx.index
      .listByType(type)
      .find(
        (n) =>
          String((n.frontmatter as Record<string, unknown>)['external_id'] ?? '').toLowerCase() ===
          wanted.toLowerCase(),
      ) ?? null
  );
}

/**
 * Meeting-review closure: when the LAST card of an after-meeting session is
 * resolved (accepted or rejected), the review is done and the meeting flips
 * `new` → `processed`. Evidence-citation flips may have landed it earlier; this
 * is the backstop that also covers all-discarded reviews. Best-effort.
 */
export async function completeMeetingReview(
  ctx: UseCaseContext,
  sessionId: string,
): Promise<{ completed: string | null }> {
  const mine = ctx.proposals.list().filter((p) => p.sessionId === sessionId);
  if (mine.length === 0) return { completed: null };
  // `arrival` is the skill that reviews a dropped meeting now; `after-meeting`
  // stays recognised for cards a workspace filed before the merge.
  if (mine[0]!.sessionType !== 'arrival' && mine[0]!.sessionType !== 'after-meeting') return { completed: null };
  if (mine.some((p) => p.status === 'pending')) return { completed: null };
  const meetingPath = mine.map((p) => p.targetPath).find((t) => t?.startsWith('meetings/'));
  if (!meetingPath) return { completed: null };
  const note = await ctx.vault.readNote(meetingPath);
  if (!note || note.type !== 'meeting') return { completed: null };
  const status = (note.frontmatter as Record<string, unknown>)['status'];
  if (status !== 'new' && status !== 'stale') return { completed: null };
  const written = await ctx.vault.writeNote(
    meetingPath,
    { ...note.frontmatter, status: 'processed' } as Frontmatter,
    note.body,
  );
  ctx.index.reindex(written);
  await ctx.git.commitPaths([meetingPath], `status: ${written.slug} → processed`);
  return { completed: meetingPath };
}

/**
 * Apply search/replace blocks (the format LLMs produce reliably, PLAN-V2 §3.1).
 * Tries an exact match first, then a whitespace-tolerant one — LLM anchors almost
 * always drift only in insignificant whitespace (indentation, trailing spaces,
 * blank-line count, CRLF), and an exact-only match falsely reports those as stale.
 * Returns null only when a block genuinely can't be located (→ stale, don't clobber).
 */
export function applyPatch(body: string, patch: { search: string; replace: string }[]): string | null {
  let result = body;
  for (const block of patch) {
    const idx = result.indexOf(block.search);
    if (idx !== -1) {
      // Same refusal contract as the fuzzy path: an anchor that appears twice
      // verbatim is ambiguous — editing "the first one" is a guess.
      if (result.indexOf(block.search, idx + 1) !== -1) return null;
      result = result.slice(0, idx) + block.replace + result.slice(idx + block.search.length);
      continue;
    }
    const fuzzy = fuzzyReplace(result, block.search, block.replace);
    if (fuzzy === null) return null;
    result = fuzzy;
  }
  return result;
}

/**
 * Replace one anchor tolerant to whitespace drift, used only after an exact match
 * fails. The anchor's inner whitespace runs are matched flexibly (`\s+`), so tabs
 * vs spaces, trailing spaces, doubled spaces, and extra blank lines no longer
 * break it. Only the anchor's CORE (trimmed) text is matched — surrounding
 * whitespace is deliberately not consumed, so structural newlines can't be eaten;
 * the same leading/trailing whitespace is dropped from the replacement to keep it
 * balanced. Returns null when the anchor is absent, or ambiguous (more than one
 * match) — a guessed location must never be edited.
 */
function fuzzyReplace(haystack: string, search: string, replace: string): string | null {
  const lead = /^\s*/.exec(search)![0];
  const trail = /\s*$/.exec(search)![0];
  const core = search.slice(lead.length, search.length - trail.length || undefined);
  const tokens = core.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const escape = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(tokens.map(escape).join('\\s+'), 'g');

  let match: RegExpExecArray | null;
  let found: { start: number; end: number } | null = null;
  while ((match = re.exec(haystack)) !== null) {
    if (match[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (found) return null; // ambiguous — refuse rather than edit the wrong place
    found = { start: match.index, end: match.index + match[0].length };
  }
  if (!found) return null;

  let repl = replace;
  if (lead && repl.startsWith(lead)) repl = repl.slice(lead.length);
  if (trail && repl.endsWith(trail)) repl = repl.slice(0, repl.length - trail.length);
  return haystack.slice(0, found.start) + repl + haystack.slice(found.end);
}
