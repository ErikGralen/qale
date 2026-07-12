import {
  zTriagePayload,
  zNotePayload,
  zUpdatePayload,
  parseFrontmatter,
  type TriagePayload,
  type ThemeStance,
  dirForType,
  fileSlug,
  type Frontmatter,
  type ThemeFrontmatter,
} from '@pm/domain';
import type { CreateProposalInput, ProposalRecord, UseCaseContext } from '../ports.js';

/**
 * Proposals are the only write path for the agent (PLAN §3.3). Tools persist
 * proposal rows here; the review layer applies accepted ones through these use
 * cases, which write files + git-commit. Accept is staleness-safe via base_hash.
 */

/** Cheap, stable content hash for staleness detection (no node dep). */
export function contentHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function createProposal(ctx: UseCaseContext, input: CreateProposalInput): ProposalRecord {
  const rec = ctx.proposals.create(input, Date.now());
  return rec;
}

export function listProposals(ctx: UseCaseContext, status?: string): ProposalRecord[] {
  return ctx.proposals.list(status);
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
  if (rec.kind === 'note') {
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
}

/** Apply an accepted proposal to the vault, dispatching by kind. */
export async function acceptProposal(
  ctx: UseCaseContext,
  id: string,
  edited?: unknown,
): Promise<AcceptResult> {
  const rec = ctx.proposals.get(id);
  if (!rec || rec.status !== 'pending') return { ok: false };

  if (rec.kind === 'triage') return acceptTriage(ctx, rec, edited);
  if (rec.kind === 'note') return acceptNote(ctx, rec, edited);
  if (rec.kind === 'update') return acceptUpdate(ctx, rec, edited);
  return { ok: false };
}

async function acceptNote(ctx: UseCaseContext, rec: ProposalRecord, edited?: unknown): Promise<AcceptResult> {
  const parsed = zNotePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false };
  const { path, frontmatter, body } = parsed.data;
  const fm = parseFrontmatter(frontmatter);
  if (!fm.ok || !fm.data) return { ok: false };
  const written = await ctx.vault.writeNote(path, fm.data as Frontmatter, body);
  ctx.index.reindex(written);
  await ctx.git.commitPaths([path], `note: ${written.slug}`);
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  return { ok: true };
}

async function acceptUpdate(ctx: UseCaseContext, rec: ProposalRecord, edited?: unknown): Promise<AcceptResult> {
  const parsed = zUpdatePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false };
  const { path, patch } = parsed.data;
  const note = await ctx.vault.readNote(path);
  if (!note) return { ok: false };
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
 * Apply search/replace blocks (the format LLMs produce reliably, PLAN §3.5).
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

async function acceptTriage(
  ctx: UseCaseContext,
  rec: ProposalRecord,
  edited?: unknown,
): Promise<AcceptResult> {
  const parsed = zTriagePayload.safeParse(edited ?? rec.payload);
  if (!parsed.success) return { ok: false };
  const payload: TriagePayload = parsed.data;

  const committed: string[] = [];

  if (payload.action === 'link') {
    const themePath = ctx.index.resolve(stripWikilink(payload.themeRef ?? ''));
    if (!themePath) return { ok: false };
    const theme = await ctx.vault.readNote(themePath);
    if (!theme) return { ok: false };
    // Staleness: the theme may have been edited in Obsidian since the proposal.
    if (rec.baseHash && contentHash(theme.body + JSON.stringify(theme.frontmatter)) !== rec.baseHash) {
      ctx.proposals.setStatus(rec.id, 'stale', Date.now());
      return { ok: false, stale: true };
    }
    const themeFm = theme.frontmatter as Record<string, unknown>;
    const evidence = new Set<string>(
      Array.isArray(themeFm['evidence']) ? (themeFm['evidence'] as string[]) : [],
    );
    for (const sig of payload.signalPaths) evidence.add(toWikilink(sig));
    const nextFm = { ...theme.frontmatter, evidence: [...evidence] } as ThemeFrontmatter;
    const written = await ctx.vault.writeNote(themePath, nextFm, theme.body);
    ctx.index.reindex(written);
    committed.push(themePath);
    await markSignals(ctx, payload.signalPaths, 'linked', committed);
  } else if (payload.action === 'new-theme') {
    if (!payload.newTheme) return { ok: false };
    const date = ctx.clock.now().slice(0, 10);
    const path = `${dirForType('theme')}/${fileSlug(payload.newTheme.summary, date).replace(/^\d{4}-\d{2}-\d{2}-/, '')}.md`;
    const fm: ThemeFrontmatter = {
      type: 'theme',
      summary: payload.newTheme.summary,
      stance: payload.newTheme.stance as ThemeStance,
      evidence: payload.signalPaths.map(toWikilink),
    };
    const written = await ctx.vault.writeNote(path, fm, `${payload.rationale}\n`);
    ctx.index.reindex(written);
    committed.push(path);
    await markSignals(ctx, payload.signalPaths, 'linked', committed);
  } else {
    await markSignals(ctx, payload.signalPaths, 'discarded', committed);
  }

  await ctx.git.commitPaths(committed, `triage: ${payload.action} (${payload.signalPaths.length} signal(s))`);
  ctx.proposals.setStatus(rec.id, 'accepted', Date.now());
  return { ok: true };
}

async function markSignals(
  ctx: UseCaseContext,
  paths: string[],
  status: 'linked' | 'discarded',
  committed: string[],
): Promise<void> {
  for (const path of paths) {
    const signal = await ctx.vault.readNote(path);
    if (!signal) continue;
    // Raw invariant: only `status` may change on a signal.
    const nextFm = { ...signal.frontmatter, status } as typeof signal.frontmatter;
    const written = await ctx.vault.writeNote(path, nextFm, signal.body);
    ctx.index.reindex(written);
    committed.push(path);
  }
}

function stripWikilink(ref: string): string {
  return ref.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.split('#')[0]!.replace(/\.md$/, '');
}

function toWikilink(path: string): string {
  return `[[${path.replace(/\.md$/, '')}]]`;
}
