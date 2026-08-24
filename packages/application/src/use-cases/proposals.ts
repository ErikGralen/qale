import {
  zNotePayload,
  zUpdatePayload,
  zDecisionPayload,
  zOutboundPayload,
  findDuplicate,
  parseFrontmatter,
  checkSupersede,
  checkFrontmatterMutation,
  isBodyEditable,
  refToSlug,
  titleFromSlug,
  typeToWrite,
  type DecisionNode,
  type DecisionFrontmatter,
  type Frontmatter,
  type OutboundPayload,
  type ProposalIdentity,
} from '@qale/domain';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../ports.js';
import { clearReasons } from './deferrals.js';
import { renameNote } from './notes.js';

/**
 * Proposals (approval cards) are the only write path for the agent (PLAN-V2 §3.3).
 * Tools persist card rows here; the Inbox applies accepted ones through these use
 * cases, which write files + git-commit. Accept is staleness-safe by re-placing
 * the edit in the note as it reads at that moment (see {@link placeBodyChange});
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

/** What a stored card is called, for comparing it against a new one. */
function cardTitle(rec: ProposalRecord): string {
  const payload = rec.payload as { frontmatter?: Record<string, unknown>; title?: string } | null;
  const fm = payload?.frontmatter;
  const fromFm = typeof fm?.['title'] === 'string' ? fm['title'] : undefined;
  const fromSummary = typeof fm?.['summary'] === 'string' ? fm['summary'] : undefined;
  // An update carries no note title of its own, so what it is FOR is its
  // rationale — the sentence the card shows the PM anyway.
  return fromFm ?? fromSummary ?? payload?.title ?? rec.rationale;
}

/** The `type` a note card would create, so a todo never collides with an insight. */
function cardNoteType(rec: ProposalRecord): string | undefined {
  const fm = (rec.payload as { frontmatter?: Record<string, unknown> } | null)?.frontmatter;
  return typeof fm?.['type'] === 'string' ? fm['type'] : undefined;
}

/**
 * The card already waiting on the PM that this one would repeat, or null.
 *
 * Reads PENDING cards across every session, which is the whole point: two runs
 * over the same material cannot see each other's proposals, and the instruction
 * to "check existing todos first" only ever reached notes already on disk. A
 * card the PM has already resolved is not consulted — rejecting something once
 * is not a standing instruction never to raise it again.
 */
export function duplicatePending(
  ctx: UseCaseContext,
  candidate: ProposalIdentity,
): ProposalRecord | null {
  const pending = ctx.proposals.list('pending').map((rec) => ({
    rec,
    kind: rec.kind,
    targetPath: rec.targetPath,
    noteType: cardNoteType(rec),
    title: cardTitle(rec),
  }));
  return findDuplicate(pending, candidate)?.rec ?? null;
}

export function listProposals(ctx: UseCaseContext, status?: string): ProposalRecord[] {
  return ctx.proposals.list(status);
}

/** One card a session put in front of the PM, as it stands right now. */
export interface SessionCardState {
  id: string;
  kind: string;
  /** What the card is called, in the words the PM sees on it. */
  title: string;
  targetPath: string | null;
  /** pending / accepted / rejected / withdrawn / stale. */
  status: string;
}

/**
 * The cards THIS session proposed, oldest first, with what has become of them.
 *
 * A session's only record of its own cards is the tool result it got when it
 * made them ("Proposed new note (p_x): …. Awaiting review."), and that sentence
 * is true for about as long as it takes the PM to click. Nothing then told the
 * session that two were approved and two are still waiting, so a correction
 * typed into the chat ("it's qale.ai, not kale") reached a model whose best
 * picture was "I proposed four cards, all pending" — and it redid the batch:
 * the approved ones came back as cards that can never land, the wrong ones
 * stayed. This is what the runtime hands it at the top of each turn instead.
 */
export function sessionCards(ctx: UseCaseContext, sessionId: string): SessionCardState[] {
  return ctx.proposals
    .list()
    .filter((rec) => rec.sessionId === sessionId)
    .sort((a, b) => a.created - b.created)
    .map((rec) => ({
      id: rec.id,
      kind: rec.kind,
      title: cardTitle(rec),
      targetPath: rec.targetPath,
      status: rec.status,
    }));
}

export interface WithdrawResult {
  ok: boolean;
  /** Why not, in a sentence the agent can act on. */
  error?: string;
}

/**
 * Take back a card the PM has not decided yet.
 *
 * The queue used to be write-only from the agent's side: `propose_*` created,
 * and nothing else. So the only way to fix a wrong card was to propose a second
 * one next to it, leaving the PM to notice the first was dead and discard it by
 * hand. Withdrawing is deliberately narrower than rejecting: it is the session
 * saying "ignore what I said", never a stand-in for the PM's decision. Hence the
 * two refusals below — a card another session owns, and a card already resolved
 * (approving it wrote a note; that note is now the PM's, and only an update card
 * may touch it).
 */
export function withdrawProposal(
  ctx: UseCaseContext,
  id: string,
  /** The session doing the withdrawing. It may only take back its own cards. */
  sessionId: string,
): WithdrawResult {
  const rec = ctx.proposals.get(id);
  if (!rec) return { ok: false, error: `no card called ${id}` };
  if (rec.sessionId !== sessionId) {
    return {
      ok: false,
      error: `${id} was proposed by another session, so it is not yours to take back`,
    };
  }
  if (rec.status !== 'pending') {
    return {
      ok: false,
      error: `${id} is already ${rec.status} — the PM decided it, and a decided card cannot be taken back`,
    };
  }
  ctx.proposals.setStatus(id, 'withdrawn', Date.now());
  return { ok: true };
}

/**
 * Rewrite what a pending card holds, in place (SK-7).
 *
 * The same three refusals withdrawing has, and for the same reasons: a card
 * that does not exist, a card another session owns, and a card the PM has
 * already decided. The third is the one that matters here: approving a card
 * applies it, and a session that could still edit the payload afterwards would
 * be editing something the PM has read and signed off.
 *
 * Only the payload moves. The id, the session, the evidence and the card's
 * place in the queue stay exactly as they were, so the PM sees one card change
 * rather than a new one arrive.
 */
export function updateProposalPayload(
  ctx: UseCaseContext,
  id: string,
  /** The session doing the rewriting. It may only revise its own cards. */
  sessionId: string,
  payload: unknown,
): WithdrawResult {
  const rec = ctx.proposals.get(id);
  if (!rec) return { ok: false, error: `no card called ${id}` };
  if (rec.sessionId !== sessionId) {
    return {
      ok: false,
      error: `${id} was proposed by another session, so it is not yours to edit`,
    };
  }
  if (rec.status !== 'pending') {
    return {
      ok: false,
      error: `${id} is already ${rec.status} — the PM decided it, and a decided card cannot be rewritten`,
    };
  }
  ctx.proposals.updatePayload(id, payload);
  return { ok: true };
}

export interface ProposalPreview {
  before: string;
  after: string;
  stale: boolean;
  /**
   * Why an update has nowhere to land, so the card can say what actually
   * happened instead of blaming a change:
   *  - `unanchored` — the text the patch points at isn't in the note any more,
   *                   or now appears more than once.
   *  - `duplicate`  — the appended text is already there word for word.
   *  - `missing`    — the target note is gone.
   */
  staleReason?: PlacementFailure | 'missing';
  /**
   * The note was edited after this card was proposed, but the edit still fits.
   * Not a blocker: the diff below is computed against the note as it now reads,
   * so what you approve is what you see. It is worth saying out loud all the
   * same, because the sentence the card was written about may have moved.
   */
  moved?: boolean;
  /**
   * Frontmatter keys this update changes, so the card can SHOW a metadata edit
   * (a todo's due/commitment) — the body diff deliberately hides frontmatter, so a
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
export async function previewProposal(
  ctx: UseCaseContext,
  id: string,
): Promise<ProposalPreview | null> {
  const rec = ctx.proposals.get(id);
  if (!rec) return null;
  if (rec.kind === 'note' || rec.kind === 'decision' || rec.kind === 'outbound') {
    const payload = rec.payload as { body?: string };
    return { before: '', after: payload.body ?? '', stale: false };
  }
  if (rec.kind === 'update') {
    const payload = rec.payload as BodyChange & {
      path: string;
      frontmatter?: Record<string, unknown>;
    };
    const note = await ctx.vault.readNote(payload.path);
    if (!note) return { before: '', after: '', stale: true, staleReason: 'missing' };
    const placed = placeBodyChange(note.body, payload);
    return {
      before: note.body,
      after: placed.ok ? placed.applied : note.body,
      stale: !placed.ok,
      staleReason: placed.ok ? undefined : placed.reason,
      moved: !!rec.baseHash && contentHash(note.body) !== rec.baseHash,
      frontmatterChanges: frontmatterDiff(
        note.frontmatter as Record<string, unknown>,
        payload.frontmatter,
      ),
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
  /** For a stale refusal, the same vocabulary the preview uses. */
  staleReason?: PlacementFailure;
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
    // A deferral is a run's note to itself that a note is not covered yet
    // (OW6). An approved card against that note IS the coverage, so the entry
    // has done its job and goes; leaving it would have the next pass reminded
    // about work that has already landed. Best-effort bookkeeping, never
    // something that can turn a successful accept into a failure.
    if (result.ok && rec.targetPath) clearReasons(ctx, rec.targetPath);
    return result;
  } finally {
    acceptsInFlight.delete(id);
  }
}

async function acceptNote(
  ctx: UseCaseContext,
  rec: ProposalRecord,
  edited?: unknown,
): Promise<AcceptResult> {
  const parsed = zNotePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid note payload' };
  const { path, frontmatter, body } = parsed.data;
  const fm = parseFrontmatter(frontmatter);
  if (!fm.ok || !fm.data) return { ok: false, error: fm.error };
  // A `note` card means a NEW note; the preview shows `before: ''`, so an
  // overwrite here would clobber an existing file sight-unseen.
  if (await ctx.vault.exists(path)) {
    return {
      ok: false,
      error: `a note already exists at ${path} — propose an update to it instead`,
    };
  }
  const written = await ctx.vault.writeNote(path, fm.data, body);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], `note: ${written.slug}`);
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  await markCitedSourcesProcessed(ctx, fm.data, rec);
  return { ok: true };
}

/**
 * When an approved derived note cites raw material (`evidence`/`sources` refs),
 * the analysis has landed: flip cited sources and unprocessed meetings from
 * `new`/`stale` to `processed`. Best-effort — a bad ref never blocks the accept.
 *
 * The CARD's evidence counts as well as the note's frontmatter. A meeting page
 * has no `sources` field — it cites its recording through `transcript` — so
 * without this an approved meeting card would leave the very transcript it was
 * written from sitting at `new`, waiting to be read a second time.
 */
async function markCitedSourcesProcessed(
  ctx: UseCaseContext,
  fm: Frontmatter,
  card?: ProposalRecord,
): Promise<void> {
  const rec = fm as Record<string, unknown>;
  const refs = [
    ...(Array.isArray(rec['evidence']) ? (rec['evidence'] as string[]) : []),
    ...(Array.isArray(rec['sources']) ? (rec['sources'] as string[]) : []),
    ...(card?.evidence ?? []).map((e) => e.ref),
  ];
  for (const ref of refs) {
    const slug = refToSlug(ref);
    if (!slug) continue;
    const path = ctx.index.resolve(slug);
    const indexed = path ? ctx.index.get(path) : null;
    if (!indexed || !path) continue;
    if (indexed.type !== 'source' && indexed.type !== 'meeting') continue;
    const processing = (indexed.frontmatter as Record<string, unknown>)['processing'];
    if (processing !== 'new' && processing !== 'stale') continue;
    const note = await ctx.vault.readNote(path);
    if (!note) continue;
    const written = await ctx.vault.writeNote(
      path,
      { ...note.frontmatter, processing: 'processed' } as Frontmatter,
      note.body,
    );
    ctx.index.reindex(written);
    await ctx.git.commitPaths([path], `processing: ${written.slug} → processed`);
  }
}

async function acceptUpdate(
  ctx: UseCaseContext,
  rec: ProposalRecord,
  edited?: unknown,
): Promise<AcceptResult> {
  const parsed = zUpdatePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid update payload' };
  const { path, patch, append, frontmatter, title } = parsed.data;
  const note = await ctx.vault.readNote(path);
  if (!note) return { ok: false, error: 'target not found' };
  // The same invariants saveFrontmatter/saveAuthoredNote enforce apply to
  // cards: an update card must not patch an immutable raw-layer body, and its
  // frontmatter merge must not rewrite protected fields (a mirror's identity,
  // a decision's spine) — a card is a write path, not a side door.
  if ((patch?.length || append?.trim()) && !isBodyEditable(note.type)) {
    return {
      ok: false,
      error: `the body of a ${note.type} note can't be edited — it only changes on re-sync`,
    };
  }
  // Re-placed against the note as it reads at this instant, never against the
  // text it read when the card was written. Approving a sibling card a second
  // ago is exactly that kind of change, and it must not cost this one its place.
  const placed = placeBodyChange(note.body, { patch, append });
  if (!placed.ok) {
    ctx.proposals.setStatus(rec.id, 'stale', Date.now());
    return { ok: false, stale: true, staleReason: placed.reason };
  }
  const applied = placed.applied;
  // Shallow-merge any frontmatter changes (reschedule a due date, close a todo)
  // over the note's current metadata — the only card path that edits frontmatter.
  //
  // `prevFm` is the note as the FILE describes itself, which is only different
  // for one that failed its schema and is therefore in memory as a plain `note`
  // (see {@link typeToWrite}). Judging such a card against our own fallback, and
  // then writing the fallback back, is how a repairable file becomes a
  // permanently mistyped one — so the declared type is restored on both sides.
  const declared = typeToWrite(
    note,
    (frontmatter as Record<string, unknown> | undefined)?.['type'],
  );
  const prevFm = { ...note.frontmatter, type: declared } as typeof note.frontmatter;
  const nextFm = frontmatter
    ? ({ ...prevFm, ...frontmatter, type: declared } as typeof note.frontmatter)
    : note.frontmatter;
  if (frontmatter) {
    // Judged as the type it is BEING READ as, which for a demoted note is the
    // permissive `note`. Deliberate: the meeting rules would refuse a repair to
    // the very provenance field that broke the file, so the librarian's card
    // could never land and the note would stay demoted for good. A file only
    // reaches that state by being edited outside the app, and the repair is
    // still something the PM approves.
    const check = checkFrontmatterMutation(note.type, prevFm, nextFm);
    if (!check.allowed) return { ok: false, error: check.reason };
    // And it has to still BE a note of its type afterwards. `acceptNote` has
    // always parsed what it writes; this path never did, so a malformed field
    // reached disk silently and the note came back from the next read as an
    // untyped `note` — the meeting gone from meetings/, with no error anywhere.
    // Only what this card breaks: a note already carrying something the schema
    // refuses must still be repairable BY a card, which is exactly the card the
    // librarian raises for one.
    const merged = parseFrontmatter(nextFm);
    if (!merged.ok && parseFrontmatter(prevFm).ok) {
      return { ok: false, error: merged.error };
    }
  }
  const written = frontmatter
    ? await ctx.vault.writeNote(path, nextFm, applied)
    : await ctx.vault.writeBody(path, applied);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], `update: ${written.slug}`);
  if (title?.trim()) {
    // Best-effort: an immutable-title type refuses the rename, but the body
    // change above already landed — the card must not fail over its garnish.
    // Said out loud all the same: a rename moves the FILE, so a refusal here can
    // be the containment guard catching a slug we built wrong, and that must not
    // look identical to "decisions cannot be retitled".
    try {
      await renameNote(ctx, { path, title });
    } catch (err) {
      logError(
        '[qale] update card: retitle failed (the body change stands):',
        err instanceof Error ? err.message : err,
      );
    }
  }
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  return { ok: true };
}

/**
 * Accept a decision card: write the new decision (append-only spine) and, when it
 * supersedes an existing one, flip the old file's standing + set the forward pointer
 * — never editing the old body. Cycle/lineage guarded (PLAN-V2 §5.6).
 */
async function acceptDecision(
  ctx: UseCaseContext,
  rec: ProposalRecord,
  edited?: unknown,
): Promise<AcceptResult> {
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
    return {
      ok: false,
      error: `a note already exists at ${path} — propose a supersede or update instead`,
    };
  }

  const committed: string[] = [];
  const targetSlug = refToSlug(supersedes);
  let newFm = fm.data as Frontmatter;

  if (targetSlug) {
    const check = checkSupersede(newSlug, targetSlug, resolveDecision);
    if (!check.allowed) return { ok: false, error: check.reason };
    const targetPath = ctx.index.resolve(targetSlug);
    const target = targetPath ? await ctx.vault.readNote(targetPath) : null;
    if (!target || !targetPath)
      return { ok: false, error: `supersede target not found: ${targetSlug}` };
    // Flip the old decision: standing → superseded, forward pointer set. Body frozen.
    const oldFm = {
      ...target.frontmatter,
      standing: 'superseded',
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
  await ctx.git.commitPaths(
    committed,
    `decision: ${written.slug}${targetSlug ? ` (supersedes ${targetSlug})` : ''}`,
  );
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  await markCitedSourcesProcessed(ctx, newFm, rec);
  return { ok: true };
}

/**
 * Accept an outbound card (PLAN-V2 §3.4): write to Jira/Confluence via the
 * outbound port on approval, never before. On failure the card stays pending (it
 * returns to the Inbox with the error — nothing half-applied). The deterministic
 * link is appended to the workspace note that spawned it.
 */
async function acceptOutbound(
  ctx: UseCaseContext,
  rec: ProposalRecord,
  edited?: unknown,
): Promise<AcceptResult> {
  const parsed = zOutboundPayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid outbound payload' };
  const p: OutboundPayload = parsed.data;

  if (!ctx.outbound)
    return { ok: false, error: 'no outbound connection is configured (connect one in Settings)' };

  // Drafted-against-stale: the card snapshotted the mirror's `remote_updated`
  // (and `version` for pages) at draft time. If the mirror has since re-synced
  // to something newer, refuse — the card stays PENDING (not flipped stale):
  // the PM re-approves after a glance, with the refreshed snapshot on the
  // edited payload, instead of losing the draft.
  const mirror = findOutboundMirror(ctx, p);
  if (mirror) {
    const fm = mirror.frontmatter as Record<string, unknown>;
    const changedSince =
      (p.remote_updated &&
        typeof fm['remote_updated'] === 'string' &&
        fm['remote_updated'] !== p.remote_updated) ||
      (p.version !== undefined && typeof fm['version'] === 'number' && fm['version'] !== p.version);
    if (changedSince) {
      return {
        ok: false,
        stale: true,
        error: `${p.targetId ?? mirror.title} changed since this was drafted. Review the change, then approve again to send anyway`,
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
      logError(
        '[qale] outbound link-back failed (push already landed):',
        err instanceof Error ? err.message : err,
      );
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
      ? (['wikipage', p.targetId] as const)
      : p.action === 'update_event' || p.action === 'respond_to_event'
        ? (['meeting', p.eventId] as const)
        : (['ticket', p.targetId] as const);
  if (!wanted) return null;
  return (
    ctx.index.listByType(type).find((n) => {
      const fm = n.frontmatter as Record<string, unknown>;
      if (String(fm['external_id'] ?? '').toLowerCase() !== wanted.toLowerCase()) return false;
      // Two providers can mint the same key (Jira PAY-142, Linear PAY-142), so
      // the id alone is not an address. A mirror that names no provider is old
      // or is a meeting, where the field is optional: it still matches.
      const provider = fm['provider'];
      return typeof provider !== 'string' || !provider || provider === p.provider;
    }) ?? null
  );
}

/** The meeting a closed-with-nothing-kept session leaves behind, for the one
 *  question the Inbox puts to the PO ("Mark it reviewed?"). */
export interface MeetingReviewAsk {
  path: string;
  title: string;
}

export interface MeetingReviewResult {
  /** The meeting that flipped to `processed`, when the review really closed. */
  completed: string | null;
  /** The meeting to ask about, when the session's cards were all discarded. */
  ask: MeetingReviewAsk | null;
}

/**
 * Take a meeting out of "needs review": `new`/`stale` → `processed`. The write
 * behind both the silent close below and the PO answering the Inbox's question.
 * `ok: false` when the note is gone or was already processed, so a caller with
 * nothing to report stays quiet.
 */
export async function markMeetingReviewed(
  ctx: UseCaseContext,
  path: string,
): Promise<{ ok: boolean }> {
  const note = await ctx.vault.readNote(path);
  if (!note || note.type !== 'meeting') return { ok: false };
  const processing = (note.frontmatter as Record<string, unknown>)['processing'];
  if (processing !== 'new' && processing !== 'stale') return { ok: false };
  const written = await ctx.vault.writeNote(
    path,
    { ...note.frontmatter, processing: 'processed' } as Frontmatter,
    note.body,
  );
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], `processing: ${written.slug} → processed`);
  return { ok: true };
}

/**
 * Meeting-review closure: when the LAST card a session produced is resolved and
 * those cards were about a meeting, the review is done and the meeting flips
 * `new` → `processed`. Evidence-citation flips may have landed it earlier; this
 * is the backstop. Which skill did the reviewing is not part of the question:
 * the checks below (a meeting target, still awaiting processing) already are it.
 *
 * Discarding EVERY card is not a review: nothing was kept, so nothing here knows
 * whether the PO read the meeting or swept the pile away. That case flips
 * nothing and hands back an `ask` instead, which the Inbox puts to them in one
 * line; until they answer, the meeting stays in "needs review". Best-effort.
 */
export async function completeMeetingReview(
  ctx: UseCaseContext,
  sessionId: string,
): Promise<MeetingReviewResult> {
  const nothing: MeetingReviewResult = { completed: null, ask: null };
  const mine = ctx.proposals.list().filter((p) => p.sessionId === sessionId);
  if (mine.length === 0) return nothing;
  if (mine.some((p) => p.status === 'pending')) return nothing;
  const meetingPath = mine.map((p) => p.targetPath).find((t) => t?.startsWith('meetings/'));
  if (!meetingPath) return nothing;
  const note = await ctx.vault.readNote(meetingPath);
  if (!note || note.type !== 'meeting') return nothing;
  const fm = note.frontmatter as Record<string, unknown>;
  if (fm['processing'] !== 'new' && fm['processing'] !== 'stale') return nothing;
  if (mine.some((p) => p.status === 'accepted')) {
    const { ok } = await markMeetingReviewed(ctx, meetingPath);
    return { completed: ok ? meetingPath : null, ask: null };
  }
  // A cancelled meeting never asked to be reviewed in the first place (the
  // renderer's `needsReview` agrees), so it is not worth a question either.
  if (fm['event_status'] === 'cancelled') return nothing;
  const title =
    typeof fm['title'] === 'string' && fm['title'].trim()
      ? (fm['title'] as string)
      : titleFromSlug(note.slug);
  return { completed: null, ask: { path: meetingPath, title } };
}

/** The two body levers an update card carries. */
export interface BodyChange {
  patch?: { search: string; replace: string }[];
  append?: string;
}

/**
 * The body an update card produces: its patch blocks applied in order, then its
 * `append` text added at the end. Review and approval both go through here, so
 * what the card previews is by construction what approving it writes.
 *
 * `append` is the lever for a note there is nothing to anchor in. A meeting page
 * mirrored from the calendar is frontmatter and no body at all, and it is
 * exactly where the write-up belongs — search/replace can never match there, so
 * without this the documented path (attach the transcript, put the summary on
 * the page the calendar already holds) had no way to end in an applied card.
 *
 * Returns null when a patch anchor can't be found — the same refusal applyPatch
 * makes, carried through so the card reads as stale rather than clobbering.
 */
export function applyBodyChange(body: string, change: BodyChange): string | null {
  const placed = placeBodyChange(body, change);
  return placed.ok ? placed.applied : null;
}

/** Why an edit has nowhere to go in the note as it currently reads. */
export type PlacementFailure =
  /** The text the patch points at is gone, or now appears more than once. */
  | 'unanchored'
  /** The appended text is already in the note word for word. */
  | 'duplicate';

/**
 * Place an update card's body change in the note as it reads RIGHT NOW, or say
 * why it has nowhere to go.
 *
 * This is the whole staleness test. It used to be preceded by a base-hash
 * comparison, which asked a different question ("did this note change at all?")
 * and was read as the answer to this one. Any byte of drift killed every other
 * pending card against the note — most often the app's own approvals, since
 * applying card 1 IS a change, so a session that proposed three edits to one
 * meeting page could only ever land the first. Anchoring is the honest test:
 * two edits to different paragraphs both apply, in either order, and two edits
 * to the same sentence still refuse, because the second one's anchor really is
 * gone once the first lands.
 *
 * `duplicate` is the guard the hash used to provide by accident. An `append` has
 * no anchor to lose, so two cards appending the same block would both apply and
 * the note would say it twice.
 */
export function placeBodyChange(
  body: string,
  change: BodyChange,
): { ok: true; applied: string } | { ok: false; reason: PlacementFailure } {
  // No patch (frontmatter-only, or append-only) → nothing to anchor; the body stands.
  const patched = change.patch?.length ? applyPatch(body, change.patch) : body;
  if (patched === null) return { ok: false, reason: 'unanchored' };
  const added = change.append?.trim();
  if (!added) return { ok: true, applied: patched };
  if (patched.includes(added)) return { ok: false, reason: 'duplicate' };
  const head = patched.replace(/\s+$/, '');
  return { ok: true, applied: head ? `${head}\n\n${added}` : added };
}

/**
 * Apply search/replace blocks (the format LLMs produce reliably, PLAN-V2 §3.1).
 * Tries an exact match first, then a whitespace-tolerant one — LLM anchors almost
 * always drift only in insignificant whitespace (indentation, trailing spaces,
 * blank-line count, CRLF), and an exact-only match falsely reports those as stale.
 * Returns null only when a block genuinely can't be located (→ stale, don't clobber).
 */
export function applyPatch(
  body: string,
  patch: { search: string; replace: string }[],
): string | null {
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
