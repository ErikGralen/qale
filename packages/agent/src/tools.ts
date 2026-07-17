import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { UseCaseContext } from '@pm/application';
import { createProposal, searchNotes, contentHash } from '@pm/application';
import { fileSlug, validateEvidence, zNotePayload, zUpdatePayload, zDecisionPayload } from '@pm/domain';
import type { SessionHarness } from '@pm/sessions';
import type { AtlassianClient } from '@pm/atlassian';

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
      if (raw !== null) harness?.recordRead(params.path);
      return text(raw ?? `Not found: ${params.path}`);
    },
  });

  const vaultList = defineTool({
    name: 'vault_list',
    label: 'List notes',
    description:
      'List notes in the workspace, optionally filtered by type (meeting, decision, insight, customer, problem, release, person, …) and/or status. Returns path, type, status and one-line summary.',
    parameters: Type.Object({
      type: Type.Optional(Type.String({ description: 'Filter by note type.' })),
      status: Type.Optional(Type.String({ description: 'Filter by status (e.g. "new").' })),
    }),
    async execute(_id, params: { type?: string; status?: string }) {
      const all = ctx.index.all();
      const rows = all.filter(
        (n) =>
          (!params.type || n.type === params.type) &&
          (!params.status || n.status === params.status),
      );
      if (rows.length === 0) return text('No matching notes.');
      const body = rows
        .map((n) => `- ${n.path} [${n.type}${n.status ? `/${n.status}` : ''}] — ${n.summary}`)
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
      'Full-text search over the vault index. Returns the top-k notes with path, summary, score and a snippet. Prefer this for open-ended questions.',
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

/**
 * Write-path tools — the agent PROPOSES, never writes (PLAN-V2 §3.3). Every card
 * is validated before persisting: cited evidence must resolve against the index or
 * a tool result, else the call fails (unless flagged inference). Cards persist as
 * rows and return an id; the Inbox applies accepted ones.
 */
export const CHECKPOINT_TOOL_NAME = 'advance_checkpoint';

/** Records a session's checkpoint progress; gated skills unlock output after it. */
export function createCheckpointTool(harness: SessionHarness): ToolDefinition {
  return defineTool({
    name: CHECKPOINT_TOOL_NAME,
    label: 'Advance checkpoint',
    description: `Advance to a named session checkpoint (one of: ${harness.config.checkpoints.join(', ')}). Call it as you pass each stage — the digest, then the outline — before drafting. Proposing is unlocked once you have advanced.`,
    parameters: Type.Object({
      checkpoint: Type.String({ description: 'The checkpoint you have just reached.' }),
    }),
    async execute(_id, params: { checkpoint: string }) {
      const r = harness.advanceCheckpoint(params.checkpoint);
      if (!r.ok) return text(`Unknown checkpoint "${params.checkpoint}". Known: ${harness.config.checkpoints.join(', ')}.`);
      return text(`Checkpoint "${params.checkpoint}" reached. Proposing is now ${harness.canPropose() ? 'unlocked' : 'still locked'}.`);
    },
  });
}

export function createProposeTools(ctx: UseCaseContext, sessionId: string, harness?: SessionHarness): ToolDefinition[] {
  const gate = (): string | null => (harness && !harness.canPropose() ? harness.gateMessage() : null);
  const proposeNote = defineTool({
    name: 'propose_note',
    label: 'Propose note',
    description:
      'Propose a NEW note (insight, meeting summary, customer/problem hub, release, person, or generic note). frontmatter must include type + summary; claim-like notes must list evidence/sources[] (wikilinks). Include tags[] with 1-2 contexts (kebab-case project/product/area, e.g. "pricing") drawn from tags already in use; name any brand-new context in the rationale. Every source must resolve unless inference:true. For decisions use propose_decision.',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace path, e.g. "insights/acme-wants-scim.md".' }),
      frontmatter: Type.Record(Type.String(), Type.Any()),
      body: Type.String(),
      rationale: Type.String(),
      sources: Type.Optional(Type.Array(Type.String())),
      inference: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params: unknown) {
      const g = gate();
      if (g) return text(g);
      const parsed = zNotePayload.safeParse(params);
      if (!parsed.success) return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const p = params as { sources?: string[]; inference?: boolean };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, !!p.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = createProposal(ctx, {
        kind: 'note',
        sessionId,
        sessionType: harness?.config.name,
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
      const g = gate();
      if (g) return text(g);
      const parsed = zDecisionPayload.safeParse(params);
      if (!parsed.success) return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const p = params as { sources?: string[]; inference?: boolean; supersedes?: string };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, !!p.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      if (p.supersedes && !ctx.index.resolve(stripLink(p.supersedes))) {
        return text(`Rejected: supersedes target not found: ${p.supersedes}`);
      }
      const rec = createProposal(ctx, {
        kind: 'decision',
        sessionId,
        sessionType: harness?.config.name,
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
      'Propose an edit to an EXISTING authored/derived note using search/replace blocks (exact anchor text + replacement). Use for answering an open question, adding evidence to a problem/customer hub, updating a meeting page, or flagging a contradiction.',
    parameters: Type.Object({
      path: Type.String(),
      patch: Type.Array(Type.Object({ search: Type.String(), replace: Type.String() })),
      rationale: Type.String(),
      sources: Type.Optional(Type.Array(Type.String())),
      inference: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params: unknown) {
      const g = gate();
      if (g) return text(g);
      const parsed = zUpdatePayload.safeParse(params);
      if (!parsed.success) return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const target = ctx.index.resolve(stripLink(parsed.data.path));
      if (!target) return text(`Rejected: target note not found: ${parsed.data.path}`);
      const note = await ctx.vault.readNote(target);
      if (!note) return text(`Rejected: cannot read ${target}`);
      const p = params as { sources?: string[]; inference?: boolean };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, !!p.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = createProposal(ctx, {
        kind: 'update',
        sessionId,
        sessionType: harness?.config.name,
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
      'Propose a tracked commitment (todo) heard in a meeting or found in a note. Use it when the PO committed to something ("I\'ll get back to you on that") OR when someone else did ("I\'ll update the docs" — then set owner to that person). Give a concrete imperative title, a due date only if one was named or clearly implied, and cite sources[] (the meeting/note where it was said). Include the verbatim quote when you have it. Check existing todos first (vault_list type "todo") and skip anything already tracked.',
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
      const g = gate();
      if (g) return text(g);
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
      const body = params.quote
        ? `> ${params.quote.trim()}\n> — ${sources[0] ?? 'source'}\n`
        : '';
      const rec = createProposal(ctx, {
        kind: 'note',
        sessionId,
        sessionType: harness?.config.name,
        targetPath: path,
        baseHash: null,
        payload: {
          path,
          frontmatter: {
            type: 'todo',
            summary: title.slice(0, 200),
            title: title.slice(0, 200),
            status: 'open',
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

export const DRAFT_TOOL_NAMES = ['draft_jira_issue', 'draft_jira_comment', 'draft_confluence_update', 'draft_message'];

/**
 * Outbound draft tools (PLAN-V2 §3.4) — the agent DRAFTS, the human approves. These
 * only ever create outbound cards; the actual Jira/Confluence write happens in the
 * card-application layer on approval. There is no auto-apply path here, ever.
 */
export function createDraftTools(ctx: UseCaseContext, sessionId: string, harness?: SessionHarness): ToolDefinition[] {
  const gate = (): string | null => (harness && !harness.canPropose() ? harness.gateMessage() : null);
  const mkCard = (payload: Record<string, unknown>, rationale: string, sources: string[], label: string) => {
    const rec = createProposal(ctx, {
      kind: 'outbound',
      sessionId,
      sessionType: harness?.config.name,
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
      'Draft a NEW Jira issue as an approval card (never created until approved). Give the projectKey, a summary, and a markdown description. Cite sources[] (the meeting/decision it came from). Optionally linkBack: a workspace note path to append the resulting Jira link to on approval.',
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
      const g = gate();
      if (g) return text(g);
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { system: 'jira', action: 'create_issue', projectKey: params.projectKey, issueType: params.issueType, title: params.summary, body: params.description, linkBackPath: params.linkBack, rationale: params.rationale },
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
    description: 'Draft a comment on an existing Jira issue (issueKey) as an approval card. Cite sources[].',
    parameters: Type.Object({
      issueKey: Type.String(),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { issueKey: string; body: string; sources: string[]; linkBack?: string; rationale: string }) {
      const g = gate();
      if (g) return text(g);
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { system: 'jira', action: 'add_comment', issueKey: params.issueKey, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale },
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
    description: 'Draft an append to a Confluence page (pageId) as an approval card. Cite sources[].',
    parameters: Type.Object({
      pageId: Type.String(),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(_id, params: { pageId: string; body: string; sources: string[]; linkBack?: string; rationale: string }) {
      const g = gate();
      if (g) return text(g);
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { system: 'confluence', action: 'update_page', pageId: params.pageId, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale },
        params.rationale,
        params.sources,
        'confluence-update',
      );
      return text(`Drafted Confluence update card (${rec.id}) on page ${params.pageId}. Awaiting approval.`);
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
      const g = gate();
      if (g) return text(g);
      const check = validateEvidence(params.sources ?? [], false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        { system: 'message', action: 'message', audience: params.audience, title: params.title, body: params.body, linkBackPath: params.linkBack, rationale: params.rationale },
        params.rationale,
        params.sources,
        'message',
      );
      return text(`Drafted ${params.audience} update card (${rec.id}). Awaiting approval.`);
    },
  });

  return [draftJiraIssue, draftJiraComment, draftConfluenceUpdate, draftMessage];
}

export const ATLASSIAN_TOOL_NAMES = ['jira_search', 'jira_get_issue', 'confluence_search', 'confluence_get_page'];

/**
 * The tracker seam (PLAN §3.3): read-only references into Jira/Confluence. Jira
 * stays the system of execution — we point at the *what*, hold the *why*. Results
 * are normalized to markdown with deep links so ask-answers can cite them.
 */
export function createAtlassianTools(client: AtlassianClient): ToolDefinition[] {
  const jiraSearch = defineTool({
    name: 'jira_search',
    label: 'Search Jira',
    description: 'Search Jira issues with a JQL query. Returns key, summary, status, assignee and a deep link.',
    parameters: Type.Object({ jql: Type.String({ description: 'A JQL query.' }) }),
    async execute(_id, params: { jql: string }) {
      const issues = await client.searchIssues(params.jql);
      if (issues.length === 0) return text('No matching Jira issues.');
      return text(
        issues.map((i) => `- ${i.key} [${i.status}] ${i.summary}${i.assignee ? ` (@${i.assignee})` : ''}\n    ${i.url}`).join('\n'),
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
      return text(`# ${i.key}: ${i.summary}\nStatus: ${i.status}${i.assignee ? ` · @${i.assignee}` : ''}\n${i.url}\n\n${i.description}`);
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
      return text(results.map((r) => `- [${r.id}] ${r.title}\n    ${r.url}\n    ${r.excerpt}`).join('\n'));
    },
  });

  const confluenceGetPage = defineTool({
    name: 'confluence_get_page',
    label: 'Get Confluence page',
    description: 'Fetch a Confluence page by id, converted to markdown.',
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params: { id: string }) {
      const page = await client.getPage(params.id);
      return text(`# ${page.title}\n${page.url}\n\n${page.body}`);
    },
  });

  return [jiraSearch, jiraGetIssue, confluenceSearch, confluenceGetPage];
}

function stripLink(ref: string): string {
  return ref.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.split('#')[0]!.replace(/\.md$/, '');
}
