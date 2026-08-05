import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { UseCaseContext } from '@qale/application';
import { applyPatch, createProposal, duplicatePending, searchNotes, contentHash } from '@qale/application';
import { checkFrontmatterMutation, fileSlug, isBodyEditable, isFolderIndex, layerForType, refToSlug, typeForDir, validateEvidence, zNotePayload, zUpdatePayload, zDecisionPayload, TYPE_RULES } from '@qale/domain';
import { buildSkillBrief, governs, parseRunnable, type Runnable, type SessionHarness } from '@qale/sessions';
import type { AtlassianClient } from '@qale/atlassian';
import { wrapExternal } from './external.js';

/**
 * Vault-scoped custom tools — the core trust mechanic (PLAN §3.3). pi's built-in
 * read/grep/find/ls tools are NOT path-confined (they accept absolute paths and
 * `~`), so the agent gets NONE of them (`noTools: 'all'`). Every read goes
 * through these tools, which resolve paths against `realpath(vaultDir)` via
 * `ctx.vault.contain` and reject anything outside.
 */

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }], details: undefined };
}

export { wrapExternal };

/**
 * Which notes hold text the PM did not write. The raw layer is exactly that set:
 * `sources` (transcripts, dropped articles, Slack threads), plus the `tickets` and
 * `wikipages` mirrors, which say whatever the upstream item says today. Authored
 * hubs and derived analyses are the PM's own words or ours over them; wrapping
 * those too would make the marker mean "text" instead of "someone else's text".
 *
 * The index answers when it knows the note; the folder answers when it doesn't, so
 * a raw note that is missing from the index cannot slip through unwrapped.
 */
function isExternalNote(ctx: UseCaseContext, path: string): boolean {
  const rec = ctx.index.get(path);
  if (rec) return rec.layer === 'raw';
  const type = typeForDir(path.split('/')[0] ?? '');
  return type ? layerForType(type) === 'raw' : false;
}

/**
 * Mirror-specific columns for `vault_list` rows: ticket/wikipage state lives in
 * frontmatter the plain row format omits, so without this a skill that scopes by
 * ticket state burns one `vault_read` per ticket just to learn it.
 */
function mirrorFields(n: { type: string; frontmatter: Record<string, unknown> }): string {
  if (n.type !== 'ticket' && n.type !== 'wikipage') return '';
  const fm = n.frontmatter;
  const parts: string[] = [];
  if (typeof fm['state'] === 'string' && fm['state']) parts.push(`state=${fm['state']}`);
  if (typeof fm['state_category'] === 'string' && fm['state_category']) parts.push(`state_category=${fm['state_category']}`);
  if (typeof fm['remote_updated'] === 'string' && fm['remote_updated']) parts.push(`remote_updated=${fm['remote_updated']}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export const VAULT_TOOL_NAMES = ['vault_read', 'vault_list', 'vault_grep', 'search_vault'];

export function createVaultTools(ctx: UseCaseContext, harness?: SessionHarness): ToolDefinition[] {
  const vaultRead = defineTool({
    name: 'vault_read',
    label: 'Read note',
    description:
      'Read a note from the workspace by its relative path (e.g. "decisions/adopt-workos.md"). Read-only, confined to the workspace.',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace-relative path to the note.' }),
    }),
    async execute(_id, params: { path: string }) {
      if (!ctx.vault.contain(params.path)) return text(`Refused: "${params.path}" is outside the workspace.`);
      const raw = await ctx.vault.readRaw(params.path);
      if (raw === null) return text(`Not found: ${params.path}`);
      harness?.recordRead(params.path);
      // A raw-layer note is a copy of someone else's words; the note path is its
      // address, the same one the model cites it by.
      return text(isExternalNote(ctx, params.path) ? wrapExternal(params.path, raw) : raw);
    },
  });

  const vaultList = defineTool({
    name: 'vault_list',
    label: 'List notes',
    description:
      'List notes in the workspace, optionally filtered by type (meeting, decision, insight, customer, theme, person, …) and/or lifecycle. Each type has its OWN lifecycle field with its own values: sources/meetings/insights/notes/mirrors have `processing` (new/processed/stale), decisions have `standing` (active/superseded), customers have `relationship` (prospect/active/churned), themes have `stance` (exploring/watching/committed/wont-do), todos have `commitment` (open/done/dropped). Returns path, type, lifecycle value and one-line summary. For orienting on a whole folder, reading that folder\'s "index.md" (e.g. "insights/index.md") gives the same map grouped by lifecycle; use this when you need to filter across folders.',
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: 'Filter by note type.' })),
      lifecycle: Type.Optional(
        Type.String({ description: 'Filter by the type\'s lifecycle value (e.g. "new", "superseded").' }),
      ),
    }),
    async execute(_id, params: { type?: string; lifecycle?: string }) {
      const all = ctx.index.all();
      const rows = all.filter(
        (n) =>
          !isFolderIndex(n.path) &&
          (!params.type || n.type === params.type) &&
          (!params.lifecycle || n.lifecycle === params.lifecycle),
      );
      if (rows.length === 0) return text('No matching notes.');
      const body = rows
        .map((n) => `- ${n.path} [${n.type}${n.lifecycle ? `/${n.lifecycle}` : ''}]${mirrorFields(n)} — ${n.summary}`)
        .join('\n');
      return text(body);
    },
  });

  const vaultGrep = defineTool({
    name: 'vault_grep',
    label: 'Grep vault',
    description: 'Case-insensitive literal search across note bodies. Returns matching notes with a snippet.',
    parameters: Type.Object({
      pattern: Type.String({ description: 'Literal text to search for.' }),
    }),
    async execute(_id, params: { pattern: string }) {
      const needle = params.pattern.toLowerCase();
      const out: string[] = [];
      for (const rec of ctx.index.all()) {
        const raw = await ctx.vault.readRaw(rec.path);
        if (raw && raw.toLowerCase().includes(needle)) {
          const idx = raw.toLowerCase().indexOf(needle);
          const snippet = raw.slice(Math.max(0, idx - 40), idx + 60).replace(/\n/g, ' ');
          out.push(`- ${rec.path}: …${snippet}…`);
          if (out.length >= 30) break;
        }
      }
      return text(out.length ? out.join('\n') : `No matches for "${params.pattern}".`);
    },
  });

  const searchVault = defineTool({
    name: 'search_vault',
    label: 'Search vault',
    description:
      'Full-text keyword search over the vault index. Returns the top-k notes with path, summary, score and a snippet. Reach for this as the fallback when the index.md maps (root and per-folder) don\'t resolve which notes to read — or when you have a specific keyword to match — rather than as the first move on an open-ended question.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query.' }),
      k: Type.Optional(Type.Number({ description: 'Max results (default 8).' })),
    }),
    async execute(_id, params: { query: string; k?: number }) {
      const hits = searchNotes(ctx, params.query, params.k ?? 8);
      for (const h of hits) harness?.recordRead(h.path);
      if (hits.length === 0) return text(`No results for "${params.query}".`);
      const body = hits
        .map((h) => `- ${h.path} (${h.type}) — ${h.summary}\n    ${h.snippet}`)
        .join('\n');
      return text(body);
    },
  });

  return [vaultRead, vaultList, vaultGrep, searchVault];
}

export const PROPOSE_TOOL_NAMES = ['propose_note', 'propose_update', 'propose_decision', 'propose_todo'];

export const USE_SKILL_TOOL_NAME = 'use_skill';

/** One on-demand skill: its parsed config plus where the file lives. */
export interface LoadableSkill {
  path: string;
  slug: string;
  config: Runnable;
}

/**
 * Every runnable a session may pull in mid-conversation (Sessions v2 Part 3.1).
 * A file is loadable when it says the model may reach it — `model-picks-it-up`
 * for a playbook, `read-when-relevant` for material. Always-on rules are
 * excluded even if they also declare one: they are already in the system
 * prompt, and loading one twice teaches the model that its instructions repeat.
 */
export async function listLoadableSkills(ctx: UseCaseContext): Promise<LoadableSkill[]> {
  const out: LoadableSkill[] = [];
  for (const n of ctx.index.all()) {
    if (n.type !== 'skill') continue;
    const raw = await ctx.vault.readRaw(n.path);
    if (!raw) continue;
    const config = parseRunnable(raw, n.slug.split('/').pop() ?? n.slug);
    if (config.starts.includes('always')) continue;
    const reachable =
      config.starts.includes('model-picks-it-up') || config.starts.includes('read-when-relevant');
    if (reachable) out.push({ path: n.path, slug: n.slug, config });
  }
  return out;
}

/** Match a model-supplied name against a skill's invocation name or its filename. */
export function matchSkill(skills: LoadableSkill[], name: string): LoadableSkill | undefined {
  const wanted = name.trim().replace(/\.md$/, '').toLowerCase();
  const file = (s: LoadableSkill) => (s.slug.split('/').pop() ?? s.slug).toLowerCase();
  return (
    skills.find((s) => s.config.name.toLowerCase() === wanted) ??
    skills.find((s) => file(s) === wanted) ??
    skills.find((s) => s.slug.toLowerCase() === wanted)
  );
}

/**
 * On-demand skill loader (Sessions v2): the skill index lists every loadable
 * runnable by name + summary in the system prompt; calling this pulls the
 * chosen one into context. Material is something you read. A file that GOVERNS
 * is more than that — it arrives with its capabilities, so loading one tells
 * the harness (and, via `onInvoke`, the runtime that re-activates the tool set).
 */
export function createUseSkillTool(
  ctx: UseCaseContext,
  harness?: SessionHarness,
  onInvoke?: (skill: LoadableSkill) => void | Promise<void>,
): ToolDefinition {
  return defineTool({
    name: USE_SKILL_TOOL_NAME,
    label: 'Use skill',
    description:
      'Load a skill into this conversation by name (see "Skills available on demand" in your instructions). ' +
      'Some are material you read; a playbook takes over how you work from here — its instructions and the ' +
      'cards it is allowed to produce. Call it the moment the conversation turns into work that skill ' +
      'describes, rather than improvising the workflow yourself.',
    parameters: Type.Object({
      name: Type.String({ description: 'The skill name, e.g. "synthesis" or "spec-review-checklist".' }),
    }),
    async execute(_id, params: { name: string }) {
      const skills = await listLoadableSkills(ctx);
      const hit = matchSkill(skills, params.name);
      if (!hit) {
        const names = skills.map((s) => s.config.name).join(', ');
        return text(`No skill named "${params.name}" is available on demand. Available: ${names || 'none'}.`);
      }
      if (governs(hit.config)) {
        harness?.invokeSkill(hit.config);
        await onInvoke?.(hit);
      }
      harness?.recordRead(hit.path);
      return text(buildSkillBrief(hit.config));
    },
  });
}

export function createProposeTools(ctx: UseCaseContext, sessionId: string, harness?: SessionHarness): ToolDefinition[] {
  /**
   * Stop a card that repeats one already in the queue, and say so in words the
   * model can act on.
   *
   * Not silent, and not a hard refusal: it reports the card that already covers
   * this and leaves the judgement where it belongs. Two runs over one meeting
   * used to fill the Inbox with pairs, and neither could see the other because
   * a pending card is not a note on disk for `vault_list` to find.
   */
  const alreadyProposed = (candidate: {
    kind: string;
    targetPath?: string | null;
    noteType?: string | undefined;
    title: string;
  }): ReturnType<typeof text> | null => {
    const hit = duplicatePending(ctx, candidate);
    if (!hit) return null;
    return text(
      `Not proposed: a card already waiting on the PM says the same thing — "${candidate.title}" (${hit.id}). ` +
        'Nothing was created, and you do not need to do anything about it. ' +
        'If what you found is genuinely different, propose it again with a title that says how it differs.',
    );
  };

  const proposeNote = defineTool({
    name: 'propose_note',
    label: 'Propose note',
    description:
      'Propose a NEW note (insight, meeting summary, customer/theme hub, person, or generic note). frontmatter must include type + summary; claim-like notes must list evidence/sources[] (wikilinks). Include tags[] with 1-2 contexts (kebab-case project/product/area, e.g. "pricing") drawn from tags already in use; name any brand-new context in the rationale. Every source must resolve unless inference:true. For decisions use propose_decision.',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace path, e.g. "insights/acme-wants-scim.md".' }),
      frontmatter: Type.Record(Type.String(), Type.Any()),
      body: Type.String(),
      rationale: Type.String(),
      sources: Type.Optional(Type.Array(Type.String())),
      inference: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params: unknown) {
      const parsed = zNotePayload.safeParse(params);
      if (!parsed.success) return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const p = params as { sources?: string[]; inference?: boolean };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, !!p.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const fm = parsed.data.frontmatter;
      const dup = alreadyProposed({
        kind: 'note',
        targetPath: parsed.data.path,
        noteType: typeof fm['type'] === 'string' ? fm['type'] : undefined,
        title:
          (typeof fm['title'] === 'string' && fm['title']) ||
          (typeof fm['summary'] === 'string' && fm['summary']) ||
          parsed.data.path,
      });
      if (dup) return dup;
      const rec = createProposal(ctx, {
        kind: 'note',
        sessionId,
        skill: harness?.activeSkillName,
        targetPath: parsed.data.path,
        baseHash: null,
        payload: parsed.data,
        rationale: parsed.data.rationale,
        evidence: sources.map((s) => ({ ref: s, resolved: true })),
        inference: !!p.inference,
      });
      harness?.recordWrite(parsed.data.path, rec.id, 'note');
      return text(`Proposed new note (${rec.id}): ${parsed.data.path}. Awaiting review.`);
    },
  });

  const proposeDecision = defineTool({
    name: 'propose_decision',
    label: 'Propose decision',
    description:
      'Propose a NEW decision for the append-only decision spine. frontmatter must include type:"decision" + summary; cite sources[] (the meeting + any evidence). Include tags[] with 1-2 contexts (kebab-case project/product/area, e.g. "pricing") drawn from tags already in use; name any brand-new context in the rationale. To record that this replaces an earlier decision, pass "supersedes" with that decision\'s slug (e.g. "decisions/use-firebase-auth") — the old decision is never edited, only marked superseded on approval.',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace path, e.g. "decisions/adopt-workos.md".' }),
      frontmatter: Type.Record(Type.String(), Type.Any()),
      body: Type.String(),
      rationale: Type.String(),
      supersedes: Type.Optional(Type.String({ description: 'Slug of the decision this replaces.' })),
      sources: Type.Optional(Type.Array(Type.String())),
      inference: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params: unknown) {
      const parsed = zDecisionPayload.safeParse(params);
      if (!parsed.success) return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const p = params as { sources?: string[]; inference?: boolean; supersedes?: string };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, !!p.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      if (p.supersedes && !ctx.index.resolve(stripLink(p.supersedes))) {
        return text(`Rejected: supersedes target not found: ${p.supersedes}`);
      }
      const fm = parsed.data.frontmatter;
      const dup = alreadyProposed({
        kind: 'decision',
        targetPath: parsed.data.path,
        title:
          (typeof fm['title'] === 'string' && fm['title']) ||
          (typeof fm['summary'] === 'string' && fm['summary']) ||
          parsed.data.path,
      });
      if (dup) return dup;
      const rec = createProposal(ctx, {
        kind: 'decision',
        sessionId,
        skill: harness?.activeSkillName,
        targetPath: parsed.data.path,
        baseHash: null,
        payload: { ...parsed.data, ...(p.supersedes ? { supersedes: stripLink(p.supersedes) } : {}) },
        rationale: parsed.data.rationale,
        evidence: sources.map((s) => ({ ref: s, resolved: true })),
        inference: !!p.inference,
      });
      harness?.recordWrite(parsed.data.path, rec.id, 'decision');
      return text(`Proposed decision (${rec.id}): ${parsed.data.path}. Awaiting review.`);
    },
  });

  const proposeUpdate = defineTool({
    name: 'propose_update',
    label: 'Propose update',
    description:
      'Propose an edit to an EXISTING authored/derived note. Two levers, use either or both: `patch` = body search/replace blocks (exact anchor text + replacement) for prose changes (answer an open question, add evidence to a hub, update a meeting page, flag a contradiction); `frontmatter` = a map of metadata keys to set on approval, the ONLY way to change a note\'s properties (a todo\'s `due` to reschedule or `commitment`+`resolved` to close it, a meeting\'s `processing`, a person\'s `last_told`). Provide at least one; omit `patch` for a metadata-only change.',
    parameters: Type.Object({
      path: Type.String(),
      patch: Type.Optional(Type.Array(Type.Object({ search: Type.String(), replace: Type.String() }))),
      frontmatter: Type.Optional(
        Type.Record(Type.String(), Type.Any(), {
          description:
            "Frontmatter keys to set, shallow-merged over the note's current properties. Use for a todo's due/commitment, a meeting's processing, or a person's last_told — the note's body stays untouched.",
        }),
      ),
      rationale: Type.String(),
      title: Type.Optional(
        Type.String({
          description:
            'New display title for the note, applied on approval. Only when the note is untitled or its title no longer fits what it says — never rename gratuitously.',
        }),
      ),
      sources: Type.Optional(Type.Array(Type.String())),
      inference: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params: unknown) {
      const parsed = zUpdatePayload.safeParse(params);
      if (!parsed.success) return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const target = ctx.index.resolve(stripLink(parsed.data.path));
      if (!target) return text(`Rejected: target note not found: ${parsed.data.path}`);
      const note = await ctx.vault.readNote(target);
      if (!note) return text(`Rejected: cannot read ${target}`);
      // Mutability guards at FILING time (same rules acceptUpdate enforces) —
      // reject where the agent can react, not at approval.
      if (parsed.data.patch?.length && !isBodyEditable(note.type)) {
        const mutable = TYPE_RULES[note.type].mutableFields ?? 'all';
        const allowed = mutable === 'all' ? 'frontmatter' : `frontmatter (${[...mutable].join(', ') || 'none'})`;
        const upstream =
          note.type === 'ticket' || note.type === 'wikipage'
            ? ' To change the upstream content, use draft_jira_comment / draft_confluence_update instead.'
            : '';
        return text(`Rejected: the body of a ${note.type} note is immutable — drop \`patch\`. Only ${allowed} may change here.${upstream}`);
      }
      if (parsed.data.frontmatter) {
        const merged = { ...note.frontmatter, ...parsed.data.frontmatter } as typeof note.frontmatter;
        const mutation = checkFrontmatterMutation(note.type, note.frontmatter, merged);
        if (!mutation.allowed) return text(`Rejected: ${mutation.reason}.`);
      }
      const p = params as { sources?: string[]; inference?: boolean };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, !!p.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      // An update has no title of its own, so what it is FOR is its rationale —
      // and two updates to one page are only duplicates if they say the same
      // thing, because a hub can legitimately collect several distinct edits.
      const dup = alreadyProposed({
        kind: 'update',
        targetPath: target,
        title: parsed.data.title ?? parsed.data.rationale,
      });
      if (dup) return dup;
      const rec = createProposal(ctx, {
        kind: 'update',
        sessionId,
        skill: harness?.activeSkillName,
        targetPath: target,
        baseHash: contentHash(note.body),
        payload: { ...parsed.data, path: target },
        rationale: parsed.data.rationale,
        evidence: sources.map((s) => ({ ref: s, resolved: true })),
        inference: !!p.inference,
      });
      harness?.recordWrite(target, rec.id, 'update');
      return text(`Proposed update (${rec.id}) to ${target}. Awaiting review.`);
    },
  });

  const proposeTodo = defineTool({
    name: 'propose_todo',
    label: 'Propose todo',
    description:
      'Propose a tracked commitment (todo) heard in a meeting or found in a note. Use it when the PO committed to something ("I\'ll get back to you on that") OR when someone else did ("I\'ll update the docs" — then set owner to that person). Give a concrete imperative title, a due date only if one was named or clearly implied, and cite sources[] (the meeting/note where it was said). Include the verbatim quote when you have it. Check existing todos first (vault_list type "todo") and skip anything already tracked; cards still awaiting review are caught here for you, so a commitment another run already proposed comes back as "not proposed" rather than landing twice.',
    parameters: Type.Object({
      title: Type.String({ description: 'The commitment, concrete and imperative, e.g. "Send Nordkap the SSO rollout dates".' }),
      due: Type.Optional(Type.String({ description: 'Due date "YYYY-MM-DD", only if named or clearly implied.' })),
      owner: Type.Optional(Type.String({ description: 'ONLY for someone else\'s commitment: who owes it — a "[[people/…]]" ref or their name. Omit for the PO\'s own todos.' })),
      quote: Type.Optional(Type.String({ description: 'The verbatim line where the commitment was made.' })),
      sources: Type.Array(Type.String({ description: 'Wikilinks to where the commitment was made, e.g. "[[meetings/2026-07-08-sprint-planning]]".' })),
      rationale: Type.String(),
      inference: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params: { title: string; due?: string; owner?: string; quote?: string; sources: string[]; rationale: string; inference?: boolean }) {
      const title = params.title.trim();
      if (!title) return text('Rejected: todo needs a title.');
      if (params.due && !/^\d{4}-\d{2}-\d{2}$/.test(params.due)) {
        return text(`Rejected: due must be "YYYY-MM-DD", got "${params.due}".`);
      }
      const sources = params.sources ?? [];
      const check = validateEvidence(sources, !!params.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const today = ctx.clock.now().slice(0, 10);
      const path = `todos/${fileSlug(title.slice(0, 200), today)}.md`;
      // The check the tool description has always asked for, now actually
      // possible: a pending card is not a note on disk, so `vault_list` could
      // never see the commitment a concurrent run proposed a minute ago.
      const dup = alreadyProposed({ kind: 'note', targetPath: path, noteType: 'todo', title });
      if (dup) return dup;
      const body = params.quote
        ? `> ${params.quote.trim()}\n> — ${sources[0] ?? 'source'}\n`
        : '';
      const rec = createProposal(ctx, {
        kind: 'note',
        sessionId,
        skill: harness?.activeSkillName,
        targetPath: path,
        baseHash: null,
        payload: {
          path,
          frontmatter: {
            type: 'todo',
            summary: title.slice(0, 200),
            title: title.slice(0, 200),
            commitment: 'open',
            sources,
            ...(params.due ? { due: params.due } : {}),
            ...(params.owner?.trim() ? { owner: params.owner.trim() } : {}),
          },
          body,
          rationale: params.rationale,
        },
        rationale: params.rationale,
        evidence: sources.map((s) => ({ ref: s, resolved: true })),
        inference: !!params.inference,
      });
      harness?.recordWrite(path, rec.id, 'note');
      const who = params.owner?.trim() ? ` (waiting on ${params.owner.trim()})` : '';
      return text(`Proposed todo (${rec.id}): ${title}${who}. Awaiting review.`);
    },
  });

  return [proposeNote, proposeUpdate, proposeDecision, proposeTodo];
}

export const DRAFT_TOOL_NAMES = [
  'draft_jira_issue',
  'draft_jira_comment',
  'draft_confluence_update',
  'draft_message',
  'draft_calendar_event',
  'draft_calendar_reschedule',
  'draft_calendar_rsvp',
];

/**
 * Outbound draft tools (PLAN-V2 §3.4) — the agent DRAFTS, the human approves. These
 * only ever create outbound cards; the actual Jira/Confluence write happens in the
 * card-application layer on approval. There is no auto-apply path here, ever.
 *
 * Tool NAMES stay provider-flavored (skill files reference them verbatim); the
 * payloads they emit are the provider-generic shape (`provider` + generic action).
 * `system` is written alongside as a deprecated mirror of `provider` so payload
 * readers from the pre-genericization era keep working.
 */
export function createDraftTools(ctx: UseCaseContext, sessionId: string, harness?: SessionHarness): ToolDefinition[] {
  /**
   * Drafted-against snapshot (the staleness baseline): when the target has a
   * mirror note, stamp the mirror's `remote_updated` (and `version` for pages)
   * into the payload at draft time. Accept compares these against the live
   * mirror and refuses when the upstream item moved since drafting. No mirror
   * ⇒ no snapshot fields.
   */
  const mirrorFor = (type: 'ticket' | 'wikipage' | 'meeting', externalId: string) => {
    const wanted = externalId.trim().toLowerCase();
    return (
      ctx.index
        .listByType(type)
        .find((n) => String(n.frontmatter['external_id'] ?? '').trim().toLowerCase() === wanted) ?? null
    );
  };
  const draftSnapshot = (type: 'ticket' | 'wikipage' | 'meeting', externalId: string): { remote_updated?: string; version?: number } => {
    const mirror = mirrorFor(type, externalId);
    if (!mirror) return {};
    const out: { remote_updated?: string; version?: number } = {};
    const ru = mirror.frontmatter['remote_updated'];
    if (typeof ru === 'string' && ru) out.remote_updated = ru;
    const v = mirror.frontmatter['version'];
    if (type === 'wikipage' && typeof v === 'number' && Number.isInteger(v) && v >= 0) out.version = v;
    return out;
  };
  const mkCard = (payload: Record<string, unknown>, rationale: string, sources: string[], label: string) => {
    const rec = createProposal(ctx, {
      kind: 'outbound',
      sessionId,
      skill: harness?.activeSkillName,
      targetPath: null,
      baseHash: null,
      payload,
      rationale,
      evidence: sources.map((s) => ({ ref: s, resolved: true })),
      inference: false,
    });
    harness?.recordWrite(String(payload['linkBackPath'] ?? label), rec.id, 'outbound');
    return rec;
  };

  const draftJiraIssue = defineTool({
    name: 'draft_jira_issue',
    label: 'Draft Jira issue',
    description:
      'Draft a NEW tracker ticket (Jira) as an approval card (never created until approved). Give the projectKey (the container), a summary, and a markdown description ending with a provenance line ("Source: <meeting>, <date>"). Cite sources[] (the meeting/decision it came from). Optionally linkBack: a workspace note path to append the created ticket\'s link to on approval.',
    parameters: Type.Object({
      projectKey: Type.String(),
      issueType: Type.Optional(Type.String()),
      summary: Type.String(),
      description: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { projectKey: string; issueType?: string; summary: string; description: string; sources: string[]; linkBack?: string; rationale: string }) {
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { provider: 'jira', system: 'jira', action: 'create_ticket', projectKey: params.projectKey, issueType: params.issueType, title: params.summary, body: params.description, linkBackPath: params.linkBack, rationale: params.rationale },
        params.rationale,
        params.sources,
        'jira-issue',
      );
      return text(`Drafted Jira issue card (${rec.id}) in ${params.projectKey}. Awaiting approval.`);
    },
  });

  const draftJiraComment = defineTool({
    name: 'draft_jira_comment',
    label: 'Draft Jira comment',
    description:
      'Draft a comment on an existing ticket as an approval card. issueKey is the ticket\'s key — take it from the ticket\'s mirror note (tickets/, frontmatter external_id) when one exists, and cite that mirror in sources[] alongside the meeting/decision. End the body with a provenance line ("Source: <meeting>, <date>").',
    parameters: Type.Object({
      issueKey: Type.String(),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { issueKey: string; body: string; sources: string[]; linkBack?: string; rationale: string }) {
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { provider: 'jira', system: 'jira', action: 'comment_ticket', issueKey: params.issueKey, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale, ...draftSnapshot('ticket', params.issueKey) },
        params.rationale,
        params.sources,
        'jira-comment',
      );
      return text(`Drafted Jira comment card (${rec.id}) on ${params.issueKey}. Awaiting approval.`);
    },
  });

  const draftConfluenceUpdate = defineTool({
    name: 'draft_confluence_update',
    label: 'Draft Confluence update',
    description:
      'Draft a change to a wikipage (Confluence) as an approval card. There are two ways to change a page; pick the one that fits. With `patch` (search + replace) that ONE passage is rewritten in place on the live page and the rest of it is left untouched, which is what you want when the page now says something wrong. The search text must be copied word for word from the page as it stands, with enough of it around the change that it appears only once. Anchor it on a plain run of prose, never on a line carrying markup (a **bold** span, a `- ` bullet, a `## ` heading, a [text](url) link): here it is checked against the page\'s mirror note, which is markdown, but on approval it is matched against the live page, where that markup is not written the same way, and the edit fails then with "the page\'s text changed". Give `provenance` with a patch: the redline is only the corrected sentence, so that one line ("Source: <origin>, <date>") is how the page says where the change came from. Without a patch, `body` is appended to the page as a new section, which is what you want when you are adding something the page does not say yet; end it with a provenance line of its own and leave the `provenance` field out, because the page gets that line as written and a second one would be added underneath. pageId is the page\'s id: take it from the wikipage\'s mirror note (wikipages/, frontmatter external_id) when one exists, and cite that mirror in sources[].',
    parameters: Type.Object({
      pageId: Type.String(),
      body: Type.Optional(Type.String({ description: 'The new section to append. Leave it out when you are patching a passage.' })),
      patch: Type.Optional(
        Type.Object(
          {
            search: Type.String({ description: "The passage to replace, word for word from the page's own text. Pick a run of plain prose, not a line carrying markup." }),
            replace: Type.String({ description: 'What it should say instead.' }),
          },
          { description: 'Replace one passage in place, instead of appending a section.' },
        ),
      ),
      provenance: Type.Optional(
        Type.String({
          description:
            'One line naming where the change came from ("Source: <origin>, <date>"), added at the very end of the page rather than beside the edit. Give it with a patch; leave it out when you are appending a body that already ends with its own.',
        }),
      ),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { pageId: string; body?: string; patch?: { search: string; replace: string }; provenance?: string; sources: string[]; linkBack?: string; rationale: string }) {
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      // A redline has to produce both halves: the whole page as it will read,
      // which is what the card previews, and the localized edit, which is what
      // the push applies. Building the preview here instead of asking for it
      // also proves the passage really is on the page, while the agent is still
      // around to go and look again.
      let body = params.body?.trim() ? params.body : null;
      if (params.patch) {
        const mirror = mirrorFor('wikipage', params.pageId);
        const note = mirror ? await ctx.vault.readNote(mirror.path) : null;
        if (!mirror || !note) {
          return text(
            `Rejected: there is no wikipage mirror for page ${params.pageId}, so the passage cannot be checked against what the page says. Append a section with \`body\` instead.`,
          );
        }
        const redlined = applyPatch(note.body, [params.patch]);
        if (redlined === null || redlined === note.body) {
          return text(
            `Rejected: that passage is not in ${mirror.path} as it stands, or it appears there more than once. Read the page again and copy the search text word for word, with enough around it to be unique.`,
          );
        }
        body = redlined;
      }
      if (!body) {
        return text('Rejected: give a `patch` to rewrite a passage in place, or a `body` to append as a new section.');
      }
      const rec = mkCard(
        { provider: 'confluence', system: 'confluence', action: 'update_page', pageId: params.pageId, body, ...(params.patch ? { patch: params.patch } : {}), ...(params.provenance?.trim() ? { provenance: params.provenance.trim() } : {}), linkBackPath: params.linkBack, rationale: params.rationale, ...draftSnapshot('wikipage', params.pageId) },
        params.rationale,
        params.sources,
        'confluence-update',
      );
      const what = params.patch ? 'Confluence redline card' : 'Confluence update card';
      return text(`Drafted ${what} (${rec.id}) on page ${params.pageId}. Awaiting approval.`);
    },
  });

  const draftMessage = defineTool({
    name: 'draft_message',
    label: 'Draft message',
    description:
      'Draft a per-audience update (CS/sales/exec) as an approval card — saved to the workspace on approval (not sent; Slack/email are out of scope). Give the audience, a markdown body, and cite sources[]. linkBack is the person/customer note to file it under.',
    parameters: Type.Object({
      audience: Type.String(),
      title: Type.Optional(Type.String()),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { audience: string; title?: string; body: string; sources: string[]; linkBack?: string; rationale: string }) {
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { provider: 'message', system: 'message', action: 'send_message', audience: params.audience, title: params.title, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale },
        params.rationale,
        params.sources,
        'message',
      );
      return text(`Drafted ${params.audience} update card (${rec.id}). Awaiting approval.`);
    },
  });

  const draftCalendarEvent = defineTool({
    name: 'draft_calendar_event',
    label: 'Draft calendar event',
    description:
      'Draft a NEW Google Calendar event as an approval card (never created until approved) — a follow-up meeting, a booked slot. Give a title (the invite summary), a start as RFC3339 with offset (e.g. 2026-08-04T15:00:00+02:00), optionally an end (defaults to +30 min) and attendee emails, and a body used as the invite description ending with a provenance line ("Source: <meeting>, <date>"). calendarId defaults to the primary calendar. Cite sources[]. linkBack: the meeting/todo note to append the created event\'s link to on approval.',
    parameters: Type.Object({
      title: Type.String(),
      start: Type.String(),
      end: Type.Optional(Type.String()),
      attendees: Type.Optional(Type.Array(Type.String())),
      calendarId: Type.Optional(Type.String()),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { title: string; start: string; end?: string; attendees?: string[]; calendarId?: string; body: string; sources: string[]; linkBack?: string; rationale: string }) {
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { provider: 'google-calendar', system: 'google-calendar', action: 'create_event', title: params.title, start: params.start, end: params.end, attendees: params.attendees, calendarId: params.calendarId, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale },
        params.rationale,
        params.sources,
        'calendar-event',
      );
      return text(`Drafted calendar event card (${rec.id}): "${params.title}". Awaiting approval.`);
    },
  });

  const draftCalendarReschedule = defineTool({
    name: 'draft_calendar_reschedule',
    label: 'Draft calendar reschedule',
    description:
      'Draft a change to an EXISTING calendar event as an approval card — a new time, a new title. eventId is the event\'s id — take it from the synced meeting note (meetings/, frontmatter external_id) and cite that note in sources[]. Give the new start/end (RFC3339 with offset) and/or title, and a body describing the change. linkBack: the meeting note to append the confirmation to.',
    parameters: Type.Object({
      eventId: Type.String(),
      calendarId: Type.Optional(Type.String()),
      title: Type.Optional(Type.String()),
      start: Type.Optional(Type.String()),
      end: Type.Optional(Type.String()),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { eventId: string; calendarId?: string; title?: string; start?: string; end?: string; body: string; sources: string[]; linkBack?: string; rationale: string }) {
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { provider: 'google-calendar', system: 'google-calendar', action: 'update_event', eventId: params.eventId, calendarId: params.calendarId, title: params.title, start: params.start, end: params.end, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale, ...draftSnapshot('meeting', params.eventId) },
        params.rationale,
        params.sources,
        'calendar-reschedule',
      );
      return text(`Drafted calendar reschedule card (${rec.id}). Awaiting approval.`);
    },
  });

  const draftCalendarRsvp = defineTool({
    name: 'draft_calendar_rsvp',
    label: 'Draft calendar RSVP',
    description:
      'Draft an RSVP to a calendar event on your behalf as an approval card. eventId is the event\'s id (from the synced meeting note\'s external_id — cite that note). attendeeEmail is your own calendar email; responseStatus is accepted/declined/tentative. Give a short body explaining the response. linkBack: the meeting note to note the RSVP on.',
    parameters: Type.Object({
      eventId: Type.String(),
      attendeeEmail: Type.String(),
      responseStatus: Type.Union([Type.Literal('accepted'), Type.Literal('declined'), Type.Literal('tentative')]),
      calendarId: Type.Optional(Type.String()),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { eventId: string; attendeeEmail: string; responseStatus: 'accepted' | 'declined' | 'tentative'; calendarId?: string; body: string; sources: string[]; linkBack?: string; rationale: string }) {
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { provider: 'google-calendar', system: 'google-calendar', action: 'respond_to_event', eventId: params.eventId, attendeeEmail: params.attendeeEmail, responseStatus: params.responseStatus, calendarId: params.calendarId, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale, ...draftSnapshot('meeting', params.eventId) },
        params.rationale,
        params.sources,
        'calendar-rsvp',
      );
      return text(`Drafted calendar RSVP card (${rec.id}): ${params.responseStatus}. Awaiting approval.`);
    },
  });

  return [draftJiraIssue, draftJiraComment, draftConfluenceUpdate, draftMessage, draftCalendarEvent, draftCalendarReschedule, draftCalendarRsvp];
}

export const ATLASSIAN_TOOL_NAMES = [
  'jira_search',
  'jira_get_issue',
  'confluence_search',
  'confluence_get_page',
  'track_external',
];

/** Start watching an external item locally. Injected by the host because it
 *  touches the sync engine, not the Atlassian client. */
export type TrackExternal = (kind: 'ticket' | 'wikipage', externalId: string) => Promise<boolean>;

/**
 * The tracker seam (PLAN §3.3): read-only references into Jira/Confluence. Jira
 * stays the system of execution — we point at the *what*, hold the *why*. Results
 * are normalized to markdown with deep links so ask-answers can cite them.
 */
export function createAtlassianTools(
  client: AtlassianClient,
  track?: TrackExternal,
): ToolDefinition[] {
  const jiraSearch = defineTool({
    name: 'jira_search',
    label: 'Search Jira',
    description: 'Search Jira issues with a JQL query. Returns key, summary, status, assignee and a deep link.',
    parameters: Type.Object({ jql: Type.String({ description: 'A JQL query.' }) }),
    async execute(_id, params: { jql: string }) {
      const issues = await client.searchIssues(params.jql);
      if (issues.length === 0) return text('No matching Jira issues.');
      // Every summary in the list was typed by whoever filed the issue, so the
      // whole result set is external; the origin is the query, not one key.
      return text(
        wrapExternal(
          'jira:search',
          issues.map((i) => `- ${i.key} [${i.status}] ${i.summary}${i.assignee ? ` (@${i.assignee})` : ''}\n    ${i.url}`).join('\n'),
        ),
      );
    },
  });

  const jiraGetIssue = defineTool({
    name: 'jira_get_issue',
    label: 'Get Jira issue',
    description: 'Fetch a single Jira issue by key (e.g. ENG-214), including its description as markdown.',
    parameters: Type.Object({ key: Type.String() }),
    async execute(_id, params: { key: string }) {
      const i = await client.getIssue(params.key);
      return text(
        wrapExternal(
          `jira:${i.key}`,
          `# ${i.key}: ${i.summary}\nStatus: ${i.status}${i.assignee ? ` · @${i.assignee}` : ''}\n${i.url}\n\n${i.description}`,
        ),
      );
    },
  });

  const confluenceSearch = defineTool({
    name: 'confluence_search',
    label: 'Search Confluence',
    description: 'Search Confluence pages with a CQL query. Returns title, deep link and an excerpt.',
    parameters: Type.Object({ cql: Type.String({ description: 'A CQL query, e.g. text ~ "SSO".' }) }),
    async execute(_id, params: { cql: string }) {
      const results = await client.searchConfluence(params.cql);
      if (results.length === 0) return text('No matching Confluence pages.');
      // Excerpts are page text: same treatment as the pages themselves.
      return text(
        wrapExternal('confluence:search', results.map((r) => `- [${r.id}] ${r.title}\n    ${r.url}\n    ${r.excerpt}`).join('\n')),
      );
    },
  });

  const confluenceGetPage = defineTool({
    name: 'confluence_get_page',
    label: 'Get Confluence page',
    description: 'Fetch a Confluence page by id, converted to markdown.',
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params: { id: string }) {
      const page = await client.getPage(params.id);
      return text(wrapExternal(`confluence:${page.id}`, `# ${page.title}\n${page.url}\n\n${page.body}`));
    },
  });

  /**
   * The one that makes a lookup stick. Searching Jira answers a question once;
   * this keeps the answer true — the item joins the local mirror, gets a status
   * chip wherever it's referenced, and starts flagging the notes that depend on
   * it when it moves.
   *
   * Deliberately NOT an outbound card: nothing is written to Jira, we're only
   * deciding to read something. Reads are silent and free (integration plan
   * §Design principles); the approval floor stays exactly where it was.
   */
  const trackExternal = defineTool({
    name: 'track_external',
    label: 'Watch item',
    description:
      'Keep an eye on a Jira issue or Confluence page: it is mirrored locally, kept up to date, ' +
      'and surfaces its status wherever notes reference it. Use when an item matters to the ' +
      "user's work — especially one outside the projects they follow, e.g. another team's " +
      'blocker. Writes nothing to Jira or Confluence.',
    parameters: Type.Object({
      kind: Type.Union([Type.Literal('ticket'), Type.Literal('wikipage')], {
        description: "'ticket' for a Jira issue, 'wikipage' for a Confluence page.",
      }),
      external_id: Type.String({ description: 'Issue key (e.g. INFRA-88) or Confluence page id.' }),
    }),
    async execute(_id, params: { kind: 'ticket' | 'wikipage'; external_id: string }) {
      if (!track) return text('Watching items is not available in this session.');
      const ok = await track(params.kind, params.external_id);
      return text(
        ok
          ? `Now watching ${params.external_id}. It will stay up to date and show its status wherever it is referenced.`
          : `Couldn't start watching ${params.external_id} just now.`,
      );
    },
  });

  return [jiraSearch, jiraGetIssue, confluenceSearch, confluenceGetPage, trackExternal];
}

/** Domain's ref parsing, with '' instead of null for plain-string call sites. */
function stripLink(ref: string): string {
  return refToSlug(ref) ?? '';
}
