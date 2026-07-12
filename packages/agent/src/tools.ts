import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { UseCaseContext } from '@pm/application';
import { searchNotes } from '@pm/application';

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
