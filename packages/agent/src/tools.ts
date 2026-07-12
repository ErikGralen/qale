import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { UseCaseContext } from '@pm/application';
import { createProposal, searchNotes, contentHash } from '@pm/application';
import { validateEvidence, zTriagePayload, zNotePayload, zUpdatePayload, THEME_STANCES } from '@pm/domain';
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

export function createVaultTools(ctx: UseCaseContext): ToolDefinition[] {
  const vaultRead = defineTool({
    name: 'vault_read',
    label: 'Read note',
    description:
      'Read a note from the vault by its relative path (e.g. "themes/sso-onboarding.md"). Read-only, confined to the vault.',
    parameters: Type.Object({
      path: Type.String({ description: 'Vault-relative path to the note.' }),
    }),
    async execute(_id, params: { path: string }) {
      if (!ctx.vault.contain(params.path)) return text(`Refused: "${params.path}" is outside the vault.`);
      const raw = await ctx.vault.readRaw(params.path);
      return text(raw ?? `Not found: ${params.path}`);
    },
  });

  const vaultList = defineTool({
    name: 'vault_list',
    label: 'List notes',
    description:
      'List notes in the vault, optionally filtered by type (signal, theme, decision, …) and/or status. Returns path, type, status and one-line summary.',
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
      if (hits.length === 0) return text(`No results for "${params.query}".`);
      const body = hits
        .map((h) => `- ${h.path} (${h.type}, score ${h.score.toFixed(2)}) — ${h.summary}\n    ${h.snippet}`)
        .join('\n');
      return text(body);
    },
  });

  return [vaultRead, vaultList, vaultGrep, searchVault];
}

export const PROPOSE_TOOL_NAMES = ['propose_triage', 'propose_note', 'propose_update'];

/**
 * Write-path tools — the agent PROPOSES, never writes (PLAN §3.3). Handlers
 * validate before persisting: signal/theme targets must resolve against the
 * index, else the call fails (unless flagged inference). Proposals persist as
 * rows and return an id; the review queue applies accepted ones.
 */
export function createProposeTools(ctx: UseCaseContext, sessionId: string): ToolDefinition[] {
  const proposeTriage = defineTool({
    name: 'propose_triage',
    label: 'Propose triage',
    description:
      'Propose a cluster-level triage decision for one or more NEW signals: link them to an existing theme, create a new theme, or discard. The group is the unit — propose one decision per cluster of duplicates. themeRef is a wikilink like "[[themes/sso-onboarding]]".',
    parameters: Type.Object({
      signalPaths: Type.Array(Type.String(), { description: 'Vault paths of the signals in this group.' }),
      action: Type.Union([Type.Literal('link'), Type.Literal('new-theme'), Type.Literal('discard')]),
      themeRef: Type.Optional(Type.String({ description: 'For "link": the existing theme wikilink.' })),
      newTheme: Type.Optional(
        Type.Object({
          summary: Type.String(),
          stance: Type.Union(THEME_STANCES.map((s) => Type.Literal(s))),
        }),
      ),
      rationale: Type.String({ description: 'One-line reason for this decision.' }),
    }),
    async execute(_id, params: unknown) {
      const parsed = zTriagePayload.safeParse(params);
      if (!parsed.success) {
        return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      }
      const payload = parsed.data;

      // Trust check: every signal (and the theme, for link) must resolve.
      const refs = [...payload.signalPaths, ...(payload.themeRef ? [payload.themeRef] : [])];
      const check = validateEvidence(refs, false, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);

      let targetPath: string | null = null;
      let baseHash: string | null = null;
      if (payload.action === 'link' && payload.themeRef) {
        targetPath = ctx.index.resolve(stripLink(payload.themeRef));
        const theme = targetPath ? await ctx.vault.readNote(targetPath) : null;
        if (theme) baseHash = contentHash(theme.body + JSON.stringify(theme.frontmatter));
      }

      const rec = createProposal(ctx, {
        kind: 'triage',
        sessionId,
        targetPath,
        baseHash,
        payload,
        rationale: payload.rationale,
        evidence: refs.map((r) => ({ ref: r, resolved: true })),
        inference: false,
      });
      return text(
        `Proposed (${rec.id}): ${payload.action} for ${payload.signalPaths.length} signal(s). Awaiting the PM's review.`,
      );
    },
  });

  const proposeNote = defineTool({
    name: 'propose_note',
    label: 'Propose note',
    description:
      'Propose a NEW note (decision, action, open-question, meeting-summary, or note). frontmatter must include type + summary; derived notes must list sources[] (wikilinks). Every source must resolve unless inference:true.',
    parameters: Type.Object({
      path: Type.String({ description: 'Vault path, e.g. "decisions/adopt-workos.md".' }),
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
      const rec = createProposal(ctx, {
        kind: 'note',
        sessionId,
        targetPath: parsed.data.path,
        baseHash: null,
        payload: parsed.data,
        rationale: parsed.data.rationale,
        evidence: sources.map((s) => ({ ref: s, resolved: true })),
        inference: !!p.inference,
      });
      return text(`Proposed new note (${rec.id}): ${parsed.data.path}. Awaiting review.`);
    },
  });

  const proposeUpdate = defineTool({
    name: 'propose_update',
    label: 'Propose update',
    description:
      'Propose an edit to an EXISTING authored/derived note using search/replace blocks (exact anchor text + replacement). Use for answering an open question, adding evidence to a theme, or flagging a contradiction.',
    parameters: Type.Object({
      path: Type.String(),
      patch: Type.Array(Type.Object({ search: Type.String(), replace: Type.String() })),
      rationale: Type.String(),
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
      const p = params as { sources?: string[]; inference?: boolean };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, !!p.inference, (ref) => !!ctx.index.resolve(stripLink(ref)));
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = createProposal(ctx, {
        kind: 'update',
        sessionId,
        targetPath: target,
        baseHash: contentHash(note.body),
        payload: { ...parsed.data, path: target },
        rationale: parsed.data.rationale,
        evidence: sources.map((s) => ({ ref: s, resolved: true })),
        inference: !!p.inference,
      });
      return text(`Proposed update (${rec.id}) to ${target}. Awaiting review.`);
    },
  });

  return [proposeTriage, proposeNote, proposeUpdate];
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
