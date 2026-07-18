import {
  zNotePayload,
  zUpdatePayload,
  zDecisionPayload,
  zOutboundPayload,
  parseFrontmatter,
  checkSupersede,
  refToSlug,
  type DecisionNode,
  type DecisionFrontmatter,
  type Frontmatter,
  type OutboundPayload,
} from '@pm/domain';
import type { CreateProposalInput, ProposalRecord, ProposalStats, UseCaseContext } from '../ports.js';

/**
 * Proposals (approval cards) are the only write path for the agent (PLAN-V2 §3.3).
 * Tools persist card rows here; the Inbox applies accepted ones through these use
 * cases, which write files + git-commit. Accept is staleness-safe via base_hash;
 * decisions supersede rather than overwrite.
 */

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

export interface GoldenAnswerInput {
  question: string;
  answer: string;
  /** Citation refs the answer relied on (wikilinks/paths/URLs). */
  sources: string[];
}

/**
 * Save-as-golden-answer (PLAN-V2 §4): turn an approved ask answer into memory —
 * an insight card citing its sources (or a note when uncited). It goes through
 * the same approval card as everything else; nothing is written silently.
 */
export function saveGoldenAnswer(ctx: UseCaseContext, input: GoldenAnswerInput): ProposalRecord {
  const cited = input.sources.filter((s) => s.trim().length > 0);
  const slugBase = input.question
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 48)
    .replace(/-+$/, '') || 'golden-answer';
  const path = `insights/${slugBase}.md`;
  const summary = input.question.replace(/\s+/g, ' ').trim().slice(0, 200);
  const body = `> ${summary}\n\n${input.answer.trim()}\n\n# Citations\n${
    cited.length ? cited.map((s) => `- ${s}`).join('\n') : '_uncited — flagged as inference_'
  }\n`;

  const frontmatter = cited.length
    ? { type: 'insight', summary, evidence: cited, confidence: 'med' }
    : { type: 'note', summary, sources: [] };

  return createProposal(ctx, {
    kind: 'note',
    sessionId: 'golden',
    targetPath: path,
    baseHash: null,
    payload: { path, frontmatter, body, rationale: `Golden answer to "${summary}"` },
    rationale: `Golden answer to "${summary}"`,
    evidence: cited.map((s) => ({ ref: s, resolved: true })),
    inference: cited.length === 0,
  });
}

/**
 * A cheap edit-distance proxy for telemetry (not a true Levenshtein — length
 * delta plus positional mismatch, which is O(n) and good enough to trend).
 */
export function editDistance(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  let diff = Math.abs(a.length - b.length);
  for (let i = 0; i < min; i++) if (a[i] !== b[i]) diff++;
  return diff;
}

export interface ProposalPreview {
  before: string;
  after: string;
  stale: boolean;
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
    const payload = rec.payload as { path: string; patch: { search: string; replace: string }[] };
    const note = await ctx.vault.readNote(payload.path);
    if (!note) return { before: '', after: '', stale: true };
    const stale = !!rec.baseHash && contentHash(note.body) !== rec.baseHash;
    const applied = applyPatch(note.body, payload.patch);
    return { before: note.body, after: applied ?? note.body, stale: stale || applied === null };
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

/** Apply an accepted proposal to the workspace, dispatching by kind. */
export async function acceptProposal(
  ctx: UseCaseContext,
  id: string,
  edited?: unknown,
): Promise<AcceptResult> {
  const rec = ctx.proposals.get(id);
  if (!rec || rec.status !== 'pending') return { ok: false };

  let result: AcceptResult;
  if (rec.kind === 'note') result = await acceptNote(ctx, rec, edited);
  else if (rec.kind === 'update') result = await acceptUpdate(ctx, rec, edited);
  else if (rec.kind === 'decision') result = await acceptDecision(ctx, rec, edited);
  else if (rec.kind === 'outbound') result = await acceptOutbound(ctx, rec, edited);
  else return { ok: false };

  // Telemetry: record how far the human edited the card before approving.
  if (result.ok && edited !== undefined) {
    ctx.proposals.setEditDistance(id, editDistance(JSON.stringify(rec.payload), JSON.stringify(edited)));
  }
  return result;
}

async function acceptNote(ctx: UseCaseContext, rec: ProposalRecord, edited?: unknown): Promise<AcceptResult> {
  const parsed = zNotePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false, error: 'invalid note payload' };
  const { path, frontmatter, body } = parsed.data;
  const fm = parseFrontmatter(frontmatter);
  if (!fm.ok || !fm.data) return { ok: false, error: fm.error };
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
  const { path, patch } = parsed.data;
  const note = await ctx.vault.readNote(path);
  if (!note) return { ok: false, error: 'target not found' };
  // Staleness: the target may have been edited in Obsidian since the proposal.
  if (rec.baseHash && contentHash(note.body) !== rec.baseHash) {
    ctx.proposals.setStatus(rec.id, 'stale', Date.now());
    return { ok: false, stale: true };
  }
  const applied = applyPatch(note.body, patch);
  if (applied === null) {
    ctx.proposals.setStatus(rec.id, 'stale', Date.now());
    return { ok: false, stale: true };
  }
  const written = await ctx.vault.writeNote(path, note.frontmatter, applied);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], `update: ${written.slug}`);
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
  if (p.system === 'message') {
    const dateLine = `> Draft for ${p.audience ?? 'stakeholders'} — ${ctx.clock.now().slice(0, 10)}\n\n`;
    if (p.linkBackPath) {
      const note = await ctx.vault.readNote(p.linkBackPath);
      if (note) {
        const next = `${note.body.trimEnd()}\n\n## Draft: ${p.title ?? p.audience ?? 'update'}\n${dateLine}${p.body}\n`;
        const written = await ctx.vault.writeNote(p.linkBackPath, note.frontmatter, next);
        ctx.index.reindex(written);
        await ctx.git.commitPaths([p.linkBackPath], `draft: ${p.audience ?? 'message'}`);
      }
    }
    ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
    return { ok: true };
  }

  if (!ctx.outbound) return { ok: false, error: 'no outbound integration configured (set Atlassian in Settings)' };

  let out: { url: string };
  try {
    if (p.system === 'jira' && p.action === 'create_issue') {
      if (!p.projectKey) return { ok: false, error: 'create_issue requires projectKey' };
      out = await ctx.outbound.createJiraIssue({ projectKey: p.projectKey, issueType: p.issueType, summary: p.title ?? '', body: p.body });
    } else if (p.system === 'jira' && p.action === 'add_comment') {
      if (!p.issueKey) return { ok: false, error: 'add_comment requires issueKey' };
      out = await ctx.outbound.addJiraComment({ issueKey: p.issueKey, body: p.body });
    } else if (p.system === 'confluence') {
      if (!p.pageId) return { ok: false, error: 'update_page requires pageId' };
      out = await ctx.outbound.updateConfluencePage({ pageId: p.pageId, body: p.body });
    } else {
      return { ok: false, error: `unsupported outbound action: ${p.system}/${p.action}` };
    }
  } catch (err) {
    // Fail the card gracefully — it stays pending, nothing half-applied.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Link-back: append the deterministic API link to the spawning note.
  if (p.linkBackPath) {
    const note = await ctx.vault.readNote(p.linkBackPath);
    if (note) {
      const line = `- ${p.system}: [${p.title ?? out.url}](${out.url})`;
      const next = /## Pushed/.test(note.body)
        ? note.body.replace(/## Pushed\n/, `## Pushed\n${line}\n`)
        : `${note.body.trimEnd()}\n\n## Pushed\n${line}\n`;
      const written = await ctx.vault.writeNote(p.linkBackPath, note.frontmatter, next);
      ctx.index.reindex(written);
      await ctx.git.commitPaths([p.linkBackPath], `pushed: ${p.system} → ${p.linkBackPath}`);
    }
  }

  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  return { ok: true, url: out.url };
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
  if (mine[0]!.sessionType !== 'after-meeting') return { completed: null };
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
 * Returns null if any block's search text isn't found (→ stale, don't clobber).
 */
export function applyPatch(body: string, patch: { search: string; replace: string }[]): string | null {
  let result = body;
  for (const block of patch) {
    const idx = result.indexOf(block.search);
    if (idx === -1) return null;
    result = result.slice(0, idx) + block.replace + result.slice(idx + block.search.length);
  }
  return result;
}
