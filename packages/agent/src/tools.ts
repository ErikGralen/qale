import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { UseCaseContext } from '@qale/application';
import {
  applyPatch,
  createProposal,
  duplicatePending,
  oneLine,
  searchNotes,
  contentHash,
  withdrawProposal,
} from '@qale/application';
import {
  badDayField,
  checkFrontmatterMutation,
  detectLanguage,
  frontmatterReference,
  NOTE_TYPES,
  type NoteType,
  fileSlug,
  isBodyEditable,
  isFolderIndex,
  isVoicePath,
  languageName,
  layerForType,
  parseFrontmatter,
  refToSlug,
  runnableCandidates,
  runnableEntryPath,
  sameLanguage,
  typeForDir,
  validateEvidence,
  zNotePayload,
  zUpdatePayload,
  zDecisionPayload,
  TYPE_RULES,
} from '@qale/domain';
import {
  buildSkillBrief,
  parseRunnable,
  HOUSE_RULES,
  HOUSE_RULES_NAME,
  type Runnable,
  type SessionHarness,
} from '@qale/sessions';
import type { ProviderReadTool } from '@qale/connectors';
import { wrapExternal } from './external.js';
import { voiceBrief, voiceRoster, resolveVoice, type Voice } from './voices.js';

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
 * How much of a raw note's own words a LISTING row may carry. A row is an
 * address plus a hint; the note itself is one `vault_read` away, and that read
 * comes back inside an envelope.
 */
const FRAGMENT_MAX = 200;

/**
 * One raw-layer fragment — a summary or a match snippet — made safe to sit in a
 * bullet list (OW9).
 *
 * `vault_read` fences a transcript, but `vault_list`, `vault_grep` and
 * `search_vault` quote from the same transcripts and hand the pieces back bare.
 * A source note's `summary` is the worst of them: nobody writes one, so the
 * normalizer copies the note's FIRST LINE into the field and marks it
 * `needs_summary`, which means the opening line of a dropped file becomes a
 * field that is then read back on every listing, every search and into
 * `sources/index.md`. An injected first line would ride along.
 *
 * A whole envelope per row would be unreadable and would tell the model that
 * paths and scores are somebody else's words too, so the fragment is flattened
 * and capped instead: it cannot become a second row, and it cannot close an
 * envelope it was pasted inside. The strong guarantee stays where the whole text
 * is, on the read.
 */
function fragment(raw: string): string {
  return oneLine(raw, FRAGMENT_MAX);
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
  if (typeof fm['state_category'] === 'string' && fm['state_category'])
    parts.push(`state_category=${fm['state_category']}`);
  if (typeof fm['remote_updated'] === 'string' && fm['remote_updated'])
    parts.push(`remote_updated=${fm['remote_updated']}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

export const VAULT_TOOL_NAMES = [
  'vault_read',
  'vault_outline',
  'vault_list',
  'vault_grep',
  'search_vault',
];

/**
 * How much of a note one `vault_read` may hand back (M3, `docs/mvp-strategy.md`).
 *
 * The read used to return the whole file whatever its size. That is fine for a
 * note somebody wrote and a context bomb for a two-hour transcript, and the
 * whole file arrives before anything can decide it was too much. The caps sit
 * well above every authored note in a real workspace (the longest runnable in
 * the seeded vault is under 200 lines), so the only thing that meets them is
 * dropped material, which is exactly what `vault_outline` plus a range is for.
 *
 * Two numbers, because one of them is always the wrong one: a transcript
 * exported as one paragraph per speaker turn is short in lines and huge in
 * characters, and a line cap alone waves it straight through.
 */
const READ_MAX_LINES = 600;
const READ_MAX_CHARS = 40_000;

/** One heading of a note, with the slice of the file it owns. */
interface Heading {
  level: number;
  text: string;
  /** 1-indexed line the heading itself is on. */
  from: number;
  /** 1-indexed last line of the section, its subsections included. */
  to: number;
}

/**
 * The heading tree of a note, in raw-file line numbers so an outline row goes
 * straight back to `vault_read` as `from`/`to`.
 *
 * Two regions are skipped, and both would otherwise report headings that are not
 * headings: the YAML frontmatter, where `#` starts a comment, and fenced code
 * blocks, where a shell snippet is full of `#` lines. Setext headings (`===`
 * under a line) are not read. Nothing here writes them, and the other setext
 * form cannot be told apart from a horizontal rule without a full parser.
 *
 * A section runs to the line before the next heading at the same level or
 * higher, so `## Pricing` carries its `###` subsections with it. That is what
 * "read that section" has to mean. Close it at the next heading of any level
 * and the model gets the first paragraph of the thing it asked for.
 */
function headings(raw: string): Heading[] {
  const lines = raw.split('\n');
  const out: Heading[] = [];
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (close > 0) start = close + 1;
  }
  let fence = '';
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const fenced = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      // A fence closes on the same character, at least as long, and with
      // nothing else on the line.
      const closes =
        fenced &&
        fenced[1]![0] === fence[0] &&
        fenced[1]!.length >= fence.length &&
        !line.slice(fenced[0].length).trim();
      if (closes) fence = '';
      continue;
    }
    if (fenced) {
      fence = fenced[1]!;
      continue;
    }
    const head = /^ {0,3}(#{1,6})(?:\s+(.*))?$/.exec(line);
    if (head)
      out.push({
        level: head[1]!.length,
        text: (head[2] ?? '').trim(),
        from: i + 1,
        to: lines.length,
      });
  }
  for (const [i, heading] of out.entries()) {
    const next = out.slice(i + 1).find((h) => h.level <= heading.level);
    if (next) heading.to = next.from - 1;
  }
  return out;
}

/** What a range asked for, once it has been checked against the note. */
type Slice = { ok: true; body: string; note: string } | { ok: false; refusal: string };

/**
 * The lines a read returns, and the line it says about them (M3).
 *
 * Truncation is the last resort here, not the mechanism: the model is meant to
 * call `vault_outline`, pick a section and ask for those lines. So the cap
 * message says which lines it dropped AND names the two ways to get the rest,
 * and every ranged read carries a "lines X-Y of N" line so the model always
 * knows where in the note it is standing.
 *
 * A read with no range comes back exactly as it did before, with no extra line
 * at all, unless it meets a cap. Every note anybody has written is under them.
 */
function readSlice(path: string, raw: string, from?: number, to?: number): Slice {
  const lines = raw.split('\n');
  const total = lines.length;
  const ranged = from !== undefined || to !== undefined;
  for (const [name, value] of [
    ['from', from],
    ['to', to],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1))
      return {
        ok: false,
        refusal: `Refused: \`${name}\` must be a whole line number, 1 or more, and it is ${JSON.stringify(value)}. Line numbers come from vault_outline.`,
      };
  }
  const start = from ?? 1;
  const asked = Math.min(to ?? total, total);
  if (start > total)
    return {
      ok: false,
      refusal: `${path} has ${total} lines, so there is nothing at line ${start}. Call vault_outline for its heading tree, then read a range inside the note.`,
    };
  if (asked < start)
    return {
      ok: false,
      refusal: `Refused: \`to\` (${to}) is before \`from\` (${start}). Give the first line, then the last.`,
    };

  // Line cap first, then the character cap over what survived it. Both cut on a
  // line boundary, so the range the message reports is the range that came back.
  let end = Math.min(asked, start + READ_MAX_LINES - 1);
  let body = lines.slice(start - 1, end).join('\n');
  let capped = end < asked;
  if (body.length > READ_MAX_CHARS) {
    // `last` is a line number, not an index: `start - 1` means nothing has fit.
    let used = 0;
    let last = start - 1;
    for (let i = start - 1; i < end; i++) {
      used += lines[i]!.length + 1;
      if (used > READ_MAX_CHARS) break;
      last = i + 1;
    }
    if (last < start) {
      // One line on its own is over the cap, so this is the one cut that lands
      // mid-line. Returning nothing would be worse than returning most of it.
      body = lines[start - 1]!.slice(0, READ_MAX_CHARS);
      end = start;
    } else {
      end = last;
      body = lines.slice(start - 1, end).join('\n');
    }
    capped = true;
  }

  if (capped)
    return {
      ok: true,
      body,
      note:
        `\n\n[Qale] Showing lines ${start}-${end} of ${total} in ${path}, which is as much as one read returns. ` +
        'Call vault_outline on this note for its heading tree, then read the section you need with `from` and `to`. ' +
        `To carry straight on from here, read it again with from: ${end + 1}.`,
    };
  if (ranged)
    return { ok: true, body, note: `\n\n[Qale] Lines ${start}-${end} of ${total} in ${path}.` };
  return { ok: true, body, note: '' };
}

/**
 * Paths inside the workspace folder that are not the memory: `.git`, `.obsidian`,
 * `sessions/.files/`, anything else a dot hides. `FsVault.walk` skips every one
 * of them, so nothing under here is indexed, listed, grepped or searched — but
 * containment alone would still hand the whole file to a `vault_read` that
 * guessed the path, and `.git/config` is not ours to read out (OW10).
 *
 * The two halves are deliberately different in kind. Discovery filters SILENTLY:
 * a listing that said "3 results, 1 withheld" would be an existence oracle over
 * paths the model cannot see. A direct read REFUSES OUT LOUD, and refuses the
 * same way whether or not the file is there, so the wording confirms the rule
 * and never the file. What it must not do is answer "Not found", which is the
 * one reply that would be a lie.
 *
 * A session's own scratch folder is reached through the rooted `files_*` tools
 * (see session-files.ts), never through here, so nothing legitimate loses a read.
 */
function isOffLimits(path: string): boolean {
  return path.split('/').some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..');
}

/**
 * The line a read carries when the note is not in the workspace language (OW5).
 * Reading a note is the moment before editing one, which is exactly where the
 * setting stops being the right answer: this file was written before the switch,
 * or by a colleague who works in the other language, and it is still in that one.
 * Detected from the text rather than assumed, and silent when the detector
 * cannot tell or the note agrees with the setting, so a workspace that never
 * mixes languages never sees this at all.
 */
function noteLanguageNote(path: string, raw: string, workspace: string | undefined): string {
  // An index.md is generated, never edited, and its one-line descriptions come
  // from the notes above it. Telling anyone what language it is in is noise.
  if (isFolderIndex(path)) return '';
  const detected = detectLanguage(raw);
  if (!detected || !workspace || sameLanguage(detected, workspace)) return '';
  return `\n\n[Qale] This note is written in ${languageName(detected)}. If you edit it, keep it in ${languageName(detected)}.`;
}

export function createVaultTools(
  ctx: UseCaseContext,
  harness?: SessionHarness,
  /** The workspace language, as a bare tag ("sv"). Absent means don't check. */
  language?: string,
): ToolDefinition[] {
  /**
   * The two guards a read has to pass before anything is opened, shared so the
   * outline cannot drift away from the read. `vault_outline` names a path the
   * same way `vault_read` does, so it has to refuse the same paths, in the same
   * words, for the same reason (OW10): a refusal that read differently from the
   * other tool's would be an existence oracle over the paths neither may show.
   */
  const refusedPath = (path: string): string | null => {
    if (!ctx.vault.contain(path)) return `Refused: "${path}" is outside the workspace.`;
    if (isOffLimits(path))
      return `Refused: "${path}" is not part of the memory. Hidden folders (.git, .obsidian, a session's own files) are never readable here, whether or not anything is at that path. Session files are reachable with files_read.`;
    return null;
  };

  const vaultRead = defineTool({
    name: 'vault_read',
    label: 'Read note',
    description:
      'Read a note from the workspace by its relative path (e.g. "decisions/adopt-workos.md"). Read-only, confined to the workspace. ' +
      'With no range it returns the whole note, which is what you want for anything a person wrote. For something long (a transcript, ' +
      'a hub page that has grown), call vault_outline first and pass the `from`/`to` of the one section you need. A read that hits the ' +
      'size cap costs you the same tool call and gives you the top of the note rather than the part you were after.',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace-relative path to the note.' }),
      from: Type.Optional(
        Type.Number({
          description:
            'First line to return, 1-indexed and inclusive. Take it from a vault_outline row. Omit to start at the top.',
        }),
      ),
      to: Type.Optional(
        Type.Number({
          description: 'Last line to return, inclusive. Omit to read to the end of the note.',
        }),
      ),
    }),
    async execute(_id, params: { path: string; from?: number; to?: number }) {
      const refused = refusedPath(params.path);
      if (refused) return text(refused);
      const raw = await ctx.vault.readRaw(params.path);
      if (raw === null) return text(`Not found: ${params.path}`);
      harness?.recordRead(params.path);
      const slice = readSlice(params.path, raw, params.from, params.to);
      if (!slice.ok) return text(slice.refusal);
      // A raw-layer note is a copy of someone else's words; the note path is its
      // address, the same one the model cites it by. Nothing is ever edited into
      // one either, so it gets no language line: the rule for a transcript is
      // "quote it as it was said", which the preamble already says.
      //
      // A range changes WHICH words, never whose, so a slice is fenced exactly
      // as the whole note is. Our own line about the range goes AFTER the
      // closing marker: inside it, it would read as one more line of the
      // transcript, which is the one thing the envelope exists to prevent.
      if (isExternalNote(ctx, params.path))
        return text(wrapExternal(params.path, slice.body) + slice.note);
      return text(slice.body + noteLanguageNote(params.path, slice.body, language) + slice.note);
    },
  });

  /**
   * The table of contents half of the drill-down pair (M3). A note is navigated
   * rather than truncated: this returns the heading tree with the line range
   * each section owns, and `vault_read` takes those numbers back.
   *
   * Heading text is flattened for the same reason `vault_grep`'s snippets are:
   * every one of them is somebody's note body verbatim, a row here is an address
   * plus a hint, and a `##` line in a dropped transcript is the cheapest place in
   * the workspace to plant a forged envelope marker.
   */
  const vaultOutline = defineTool({
    name: 'vault_outline',
    label: 'Outline note',
    description:
      'Get the heading tree of a note: every heading, with the line range that section covers. Reach for this BEFORE reading anything ' +
      'long (a meeting transcript, a dropped article, a hub page that has grown), and then vault_read only the section you need, ' +
      'instead of pulling the whole note into the conversation to find one paragraph. Each row reads "from-to" and then the heading ' +
      "as it is written; a section's range includes its subsections, so the two numbers go straight back to vault_read as `from` and " +
      '`to`. A note with no headings says so and gives its length. Do not spend a call on this for a short note: read that one whole.',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace-relative path to the note.' }),
    }),
    async execute(_id, params: { path: string }) {
      const refused = refusedPath(params.path);
      if (refused) return text(refused);
      const raw = await ctx.vault.readRaw(params.path);
      if (raw === null) return text(`Not found: ${params.path}`);
      harness?.recordRead(params.path);
      const total = raw.split('\n').length;
      const tree = headings(raw);
      // A note under the cap can be read whole, and saying so is what stops the
      // pair costing two calls where one always did.
      const advice =
        total > READ_MAX_LINES
          ? 'One read returns at most ' +
            `${READ_MAX_LINES} lines, so take it a section at a time with vault_read \`from\` and \`to\`.`
          : 'Read a section with vault_read `from` and `to`, or read the whole note.';
      if (tree.length === 0) return text(`${params.path}: ${total} lines, no headings. ${advice}`);
      const rows = tree.map(
        (h) => `- ${h.from}-${h.to} ${'#'.repeat(h.level)} ${fragment(h.text)}`,
      );
      return text(
        `${params.path}: ${total} lines, ${tree.length} headings. ${advice}\n${rows.join('\n')}`,
      );
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
        Type.String({
          description: 'Filter by the type\'s lifecycle value (e.g. "new", "superseded").',
        }),
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
        .map(
          (n) =>
            `- ${n.path} [${n.type}${n.lifecycle ? `/${n.lifecycle}` : ''}]${mirrorFields(n)} — ` +
            // A raw note's summary is its own first line more often than not.
            `${isExternalNote(ctx, n.path) ? fragment(n.summary) : n.summary}`,
        )
        .join('\n');
      return text(body);
    },
  });

  const vaultGrep = defineTool({
    name: 'vault_grep',
    label: 'Grep vault',
    description:
      'Case-insensitive literal search across note bodies. Returns matching notes with a snippet.',
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
          // Every snippet is somebody's note body verbatim, so all of them are
          // flattened; only the raw layer can be somebody ELSE's, but a match in
          // an authored note is still text, not a line of the tool's own output.
          const snippet = fragment(raw.slice(Math.max(0, idx - 40), idx + 60));
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
      "Full-text keyword search over the vault index. Returns the top-k notes with path, summary, score and a snippet. Reach for this as the fallback when the index.md maps (root and per-folder) don't resolve which notes to read — or when you have a specific keyword to match — rather than as the first move on an open-ended question.",
    parameters: Type.Object({
      query: Type.String({ description: 'Search query.' }),
      k: Type.Optional(Type.Number({ description: 'Max results (default 8).' })),
    }),
    async execute(_id, params: { query: string; k?: number }) {
      const hits = searchNotes(ctx, params.query, params.k ?? 8);
      for (const h of hits) harness?.recordRead(h.path);
      if (hits.length === 0) return text(`No results for "${params.query}".`);
      const body = hits
        .map((h) => {
          const summary = isExternalNote(ctx, h.path) ? fragment(h.summary) : h.summary;
          return `- ${h.path} (${h.type}) — ${summary}\n    ${fragment(h.snippet)}`;
        })
        .join('\n');
      return text(body);
    },
  });

  return [vaultRead, vaultOutline, vaultList, vaultGrep, searchVault];
}

export const PROPOSE_TOOL_NAMES = [
  'propose_note',
  'propose_meeting',
  'propose_update',
  'propose_decision',
  'propose_todo',
  'propose_instruction',
];

export const WITHDRAW_TOOL_NAME = 'withdraw_proposal';

export const USE_SKILL_TOOL_NAME = 'use_skill';

/** One on-demand skill: its parsed config plus where the file lives. */
export interface LoadableSkill {
  path: string;
  slug: string;
  config: Runnable;
}

/**
 * Every skill a session may pull in mid-conversation (Sessions v2 Part 3.1).
 * That is all of them now: a skill IS work the model may reach for, so nothing
 * in the file decides it any more (SK-2). The house rules are the one file left
 * out, because they are already in the system prompt and loading them twice
 * teaches the model that its instructions repeat.
 */
export async function listLoadableSkills(ctx: UseCaseContext): Promise<LoadableSkill[]> {
  const out: LoadableSkill[] = [];
  for (const n of ctx.index.all()) {
    if (n.type !== 'skill') continue;
    // A voice is filed as a skill note but is not work anyone reaches for: it
    // is how a draft sounds, applied by the drafting tools (SK-6). Offering one
    // through `use_skill` would put tone in force as if it were a workflow.
    if (isVoicePath(n.path)) continue;
    const raw = await ctx.vault.readRaw(n.path);
    if (!raw) continue;
    const config = parseRunnable(raw, n.slug.split('/').pop() ?? n.slug);
    if (config.name === HOUSE_RULES_NAME) continue;
    out.push({ path: n.path, slug: n.slug, config });
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
 * skill by name + summary in the system prompt; calling this pulls the chosen
 * one into context. A skill is more than something you read — it arrives with
 * its capabilities, so loading one tells the harness (and, via `onInvoke`, the
 * runtime that re-activates the tool set).
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
      'It takes over how you work from here — its instructions and the cards it is allowed to produce. ' +
      'Call it the moment the conversation turns into work that skill describes, rather than improvising ' +
      'the workflow yourself.',
    parameters: Type.Object({
      name: Type.String({
        description: 'The skill name, e.g. "synthesis" or "spec-review-checklist".',
      }),
    }),
    async execute(_id, params: { name: string }) {
      const skills = await listLoadableSkills(ctx);
      const hit = matchSkill(skills, params.name);
      if (!hit) {
        const names = skills.map((s) => s.config.name).join(', ');
        return text(
          `No skill named "${params.name}" is available on demand. Available: ${names || 'none'}.`,
        );
      }
      harness?.invokeSkill(hit.config);
      await onInvoke?.(hit);
      harness?.recordRead(hit.path);
      return text(buildSkillBrief(hit.config));
    },
  });
}

/**
 * What a card is allowed to cite — the one answer both the propose and the draft
 * tools ask, so a meeting is not citable on a todo and refused on a Jira comment.
 *
 * A citation resolves if the note is on disk, OR if a card waiting on the PM
 * would create it. The second half is what lets one reading hold together. The
 * meeting page is proposed now rather than written, so without it every todo and
 * decision from a meeting would have to cite the raw transcript instead —
 * technically true, and a worse memory: what a commitment came out of is the
 * meeting, and that is what the PM should see on the card and be able to follow
 * from the todo forever after.
 *
 * The cost is real and bounded, and it is worth naming. Approve the todo,
 * decline the meeting, and the todo cites a page that was never written. That is
 * a broken link, which is the one kind of damage this workspace already knows
 * how to find by itself: the librarian's scan reads frontmatter refs as edges,
 * so it comes back as a `broken-link` finding with repair hints on the next tick
 * and a session proposes the repair. A link the librarian will raise beats a
 * citation that pointed at the wrong thing from the start and never will be.
 */
function citations(ctx: UseCaseContext): {
  resolves: (ref: string) => boolean;
  evidenceRows: (sources: string[]) => { ref: string; resolved: boolean }[];
} {
  /** The note a pending card would create, as the slug a citation would use. */
  const pendingSlugs = (): Set<string> => {
    const out = new Set<string>();
    for (const rec of ctx.proposals.list('pending')) {
      // An update card's target already exists, so it adds nothing here; only
      // the kinds that CREATE a note put a new address into the world.
      if (rec.kind === 'update' || rec.kind === 'outbound' || !rec.targetPath) continue;
      out.add(rec.targetPath.replace(/\.md$/, ''));
    }
    return out;
  };
  return {
    resolves: (ref) => {
      const bare = stripLink(ref);
      return !!ctx.index.resolve(bare) || pendingSlugs().has(bare);
    },
    // `resolved` stays honest about which of the two it was, so a surface that
    // wants to say "not written yet" has the fact rather than a guess.
    evidenceRows: (sources) =>
      sources.map((ref) => ({ ref, resolved: !!ctx.index.resolve(stripLink(ref)) })),
  };
}

/** How long a standing instruction may be before it stops being one sentence. */
const RULE_MAX = 300;

/** The heading a standing instruction is filed under, in a skill or an agent. */
const RULES_HEADING = '## Standing instructions';

/**
 * Where a rule goes when no single skill or agent owns it: the last section of
 * the house rules, the one document every session reads (SK-3). It is the last
 * heading in that file on purpose — an `append` lands at the end, and a section
 * with prose after it would take a fresh heading instead of the bullet.
 */
const HOUSE_RULES_HEADING = '## Your rules';

/** What a rule looks like once the differences that are not differences are gone. */
function normalizeRule(rule: string): string {
  return rule
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:]+$/, '');
}

/** The words of a heading, whatever its level: "## Your rules" → "your rules". */
function headingWords(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .trim()
    .toLowerCase();
}

function isRulesHeading(line: string, heading: string): boolean {
  return /^#{1,6}\s/.test(line.trim()) && headingWords(line) === headingWords(heading);
}

/** The rules a body already carries, read off the section they are filed under. */
function existingRules(body: string, heading: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of body.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      inside = isRulesHeading(line, heading);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (inside && bullet) out.push(bullet[1]!.trim());
  }
  return out;
}

/**
 * Is the rules section the last thing in the body? Only then can a bare bullet
 * join it: `append` lands at the end of the file and nowhere else, so a section
 * with prose after it needs a fresh heading rather than a bullet that would
 * attach itself to whatever the file happens to end with.
 */
function rulesSectionIsLast(body: string, heading: string): boolean {
  const headings = body.split('\n').filter((line) => /^#{1,6}\s/.test(line));
  const last = headings.at(-1);
  return !!last && isRulesHeading(last, heading);
}

/**
 * The two ways a card may carry no sources[], offered as separate flags because
 * they are opposite things to the PM. `asked` is their own words coming back;
 * `inference` is the agent's own reasoning with nothing behind it. One flag for
 * both meant a note the PM dictated arrived wearing "the agent inferred this
 * without citing a source", which is the one card they should never doubt.
 */
const ASKED_PARAM = Type.Optional(
  Type.Boolean({
    description:
      'True when the PM asked for this in the conversation: their message IS the source, and a message is not a note you can cite. Stands in for sources[], and the card says they asked for it. Never for something you worked out yourself.',
  }),
);

const INFERENCE_PARAM = Type.Optional(
  Type.Boolean({
    description:
      'True when you worked this out yourself and nothing in the workspace or the conversation says it. The card is flagged for the PM to double-check, so use it only when there is genuinely nothing to point at.',
  }),
);

export function createProposeTools(
  ctx: UseCaseContext,
  sessionId: string,
  harness?: SessionHarness,
): ToolDefinition[] {
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

  /**
   * Stop a CREATE card whose note is already on disk.
   *
   * Almost always this is the session's own approved work coming back. Nothing
   * ever told a session what became of its cards, so a correction typed into the
   * chat ("it's qale.ai, not kale") used to make it redo the whole batch,
   * approved ones included — and those landed as cards that can never be
   * accepted, because `acceptNote`/`acceptDecision` refuse to overwrite a file
   * they would show the PM an empty "before" for. A card that cannot land is
   * worse than no card: it reads as work waiting, and the only way out of it is
   * a discard the PM has to reason about. Refuse it here, where the model can
   * still do the right thing with the answer.
   */
  const alreadyOnDisk = async (path: string): Promise<ReturnType<typeof text> | null> => {
    if (!ctx.index.resolve(path.replace(/\.md$/, '')) && !(await ctx.vault.exists(path)))
      return null;
    return text(
      `Not proposed: ${path} already exists as a note — usually a card of yours the PM has already approved. ` +
        'Approving it is what wrote the note, and it is theirs now, so a second create card for that path could ' +
        'never be applied. If it needs to change, propose_update it instead.',
    );
  };

  const { resolves, evidenceRows } = citations(ctx);

  /**
   * The note-schema check, run at FILING time for the same reason the
   * mutability guards are: a frontmatter the schema refuses can never be
   * approved, so leaving it for `acceptNote` hands the PM a red box on a card
   * they have already read and agreed with, and the only ways out of it are a
   * Retry that fails identically and hand-editing YAML.
   *
   * Here the model still has the note in front of it and the message names the
   * field, so the usual outcome is that it writes the field properly and the
   * card the PM sees is one that can land. (The common miss is a list field
   * given as a single mapping — `verified:` with `by:`/`at:` under it — which
   * the schema now reads as the one-entry list it means; what survives to here
   * is the genuinely malformed.)
   */
  const badFrontmatter = (frontmatter: Record<string, unknown>): ReturnType<typeof text> | null => {
    // A day field that does not hold a day passes every schema and then sorts
    // wrong forever, so it is checked by shape rather than by type.
    const day = badDayField(frontmatter);
    if (day) {
      return text(
        `Rejected: "${day.field}" has to be a date written "YYYY-MM-DD", not ${JSON.stringify(day.value)}. ` +
          'Work out the actual day and write that, or leave the field off.',
      );
    }
    const parsed = parseFrontmatter(frontmatter);
    if (parsed.ok) return null;
    // The shape of the type in question, generated from the schema that just
    // refused it (FH-2) — the answer, not just the complaint.
    const type = frontmatter['type'];
    const shape =
      typeof type === 'string' && (NOTE_TYPES as readonly string[]).includes(type)
        ? `\n\n${frontmatterReference([type as NoteType])}`
        : '';
    return text(
      `Rejected: that frontmatter does not fit the note's schema — ${parsed.error}. ` +
        `Fix the field named there and propose again; the card could not be approved as written.${shape}`,
    );
  };

  const proposeNote = defineTool({
    name: 'propose_note',
    label: 'Propose note',
    description:
      'Propose a NEW note (insight, meeting summary, customer/theme hub, person, or generic note). frontmatter must include type + summary; claim-like notes must list evidence/sources[] (wikilinks). Include tags[] with 1-2 contexts (kebab-case project/product/area, e.g. "pricing") drawn from tags already in use; name any brand-new context in the rationale. Every source must resolve unless asked:true or inference:true. For decisions use propose_decision.',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace path, e.g. "insights/acme-wants-scim.md".' }),
      frontmatter: Type.Record(Type.String(), Type.Any()),
      body: Type.String(),
      rationale: Type.String(),
      sources: Type.Optional(Type.Array(Type.String())),
      asked: ASKED_PARAM,
      inference: INFERENCE_PARAM,
    }),
    async execute(_id, params: unknown) {
      const parsed = zNotePayload.safeParse(params);
      if (!parsed.success)
        return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const p = params as { sources?: string[]; inference?: boolean; asked?: boolean };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, resolves, {
        inference: !!p.inference,
        asked: !!p.asked,
      });
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const exists = await alreadyOnDisk(parsed.data.path);
      if (exists) return exists;
      const fm = parsed.data.frontmatter;
      const invalid = badFrontmatter(fm);
      if (invalid) return invalid;
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
        evidence: evidenceRows(sources),
        inference: !!p.inference,
        asked: !!p.asked,
      });
      harness?.recordWrite(parsed.data.path, rec.id, 'note');
      return text(`Proposed new note (${rec.id}): ${parsed.data.path}. Awaiting review.`);
    },
  });

  /**
   * The meeting page, proposed whole (docs/arrival-agentic.md).
   *
   * A transcript arriving used to write its meeting page immediately — an empty
   * scaffold with "not read yet" where the summary belongs — and the summary
   * then came along behind it as an update card. Two steps, and the first of
   * them put a page in the workspace nobody had approved. Here the page is one
   * card: the summary is its body, the transcript is its evidence, and until the
   * PM says yes there is nothing in `meetings/` at all.
   *
   * The shape is fixed by the tool rather than by the model, exactly as
   * `propose_todo` fixes a todo's: the path carries the meeting's own date, the
   * summary sits under `## Summary` with `## Notes` left empty above it for the
   * PM, and the transcripts are cited as evidence so approving the meeting is
   * what flips them to `processed`.
   */
  const proposeMeeting = defineTool({
    name: 'propose_meeting',
    label: 'Propose meeting',
    description:
      "Propose a NEW meeting page for a recording you just filed — the summary and the page are ONE card, so nothing lands in meetings/ until the PM approves it. Use it after file_material has put the transcript in sources/ and no meeting page exists yet. Name every transcript in `transcript` (the source paths file_material reported): they become the page's evidence and flip to processed on approval. `summary` is the meeting written up in your own voice — what was decided, what is open, what happens next — not a paste of the transcript. `participants` is who was in it, and a meeting needs it: set it from whoever speaks in the transcript, or set `participants_unknown` when the material names nobody. If the calendar ALREADY holds this meeting, do not use this: attach the transcript with file_material `attach_to` and propose_update the summary onto the page that exists.",
    parameters: Type.Object({
      title: Type.String({
        description: 'What the meeting is called, in the words a person would use.',
      }),
      date: Type.String({
        description: 'The day it happened, "YYYY-MM-DD", as the material itself states it.',
      }),
      summary: Type.String({
        description: "The write-up, markdown. It becomes the page's Summary section.",
      }),
      transcript: Type.Array(Type.String(), {
        description:
          'The transcript source notes this meeting is recorded by, e.g. ["sources/2026-08-04-nordkap-qbr-transcript.md"].',
      }),
      participants: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Who was in it, from whoever speaks in the transcript: "[[people/…]]" refs where the person has a page, else their plain name. A plain name is fine and is how a person page gets made later.',
        }),
      ),
      participants_unknown: Type.Optional(
        Type.Boolean({
          description:
            'Only when the material genuinely names nobody (speaker labels only). Says you looked and there is no name to write. Required when `participants` is empty.',
        }),
      ),
      customer: Type.Optional(
        Type.String({
          description: 'The customer this meeting was with, as a "[[customers/…]]" ref.',
        }),
      ),
      tags: Type.Optional(
        Type.Array(Type.String({ description: 'One or two contexts already in use, kebab-case.' })),
      ),
      rationale: Type.String(),
      sources: Type.Optional(
        Type.Array(
          Type.String({
            description: 'Anything else the write-up rests on. The transcripts are added for you.',
          }),
        ),
      ),
      inference: INFERENCE_PARAM,
    }),
    async execute(
      _id,
      params: {
        title: string;
        date: string;
        summary: string;
        transcript: string[];
        participants?: string[];
        participants_unknown?: boolean;
        customer?: string;
        tags?: string[];
        rationale: string;
        sources?: string[];
        inference?: boolean;
      },
    ) {
      const title = params.title.trim();
      if (!title) return text('Rejected: a meeting needs a title — it is what the page is called.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
        return text(`Rejected: date must be "YYYY-MM-DD", got "${params.date}".`);
      }
      if (!params.summary.trim()) {
        return text(
          'Rejected: the summary is the whole point of the card. Write the meeting up, or propose nothing.',
        );
      }
      if (params.transcript.length === 0) {
        return text(
          'Rejected: name the transcript(s) this meeting is recorded by. File the recording with file_material first; it reports the paths.',
        );
      }
      // Every transcript must exist and be raw material. A meeting page whose
      // `transcript` points at nothing reads as "this meeting has no recording",
      // which is the one wrong answer that loses the evidence entirely.
      const refs: string[] = [];
      for (const ref of params.transcript) {
        const path = ctx.index.resolve(stripLink(ref));
        if (!path)
          return text(
            `Rejected: no note called "${ref}" — file the recording first, then cite the path it reports.`,
          );
        const rec = ctx.index.get(path);
        if (rec && rec.type !== 'source') {
          return text(
            `Rejected: "${ref}" is a ${rec.type} note, not a transcript. Only source notes can be a meeting's recording.`,
          );
        }
        refs.push(`[[${path.replace(/\.md$/, '')}]]`);
      }
      const path = `meetings/${fileSlug(title.slice(0, 200), params.date)}.md`;
      if (ctx.index.resolve(path.replace(/\.md$/, '')) || (await ctx.vault.exists(path))) {
        return text(
          `Not proposed: ${path} already exists. That meeting has a page — attach the recording to it with file_material \`attach_to\`, then propose_update the summary onto it.`,
        );
      }
      const dup = alreadyProposed({ kind: 'note', targetPath: path, noteType: 'meeting', title });
      if (dup) return dup;
      // A meeting that lands with nobody on it is the omission the PM cannot
      // repair by noticing it: the page shows no participant chips, so the click
      // that turns a name into a person page never appears, and the meeting is
      // invisible from every person it was actually with. Transcripts name their
      // speakers far more often than not, and an optional field with nothing
      // asking for it was simply skipped. Refused here rather than nudged
      // afterwards, because once the card exists the path is taken and
      // `alreadyProposed` refuses the second one. The flag is the way through
      // for material that really does name nobody.
      if (!params.participants?.length && !params.participants_unknown) {
        return text(
          'Rejected: nobody is on this meeting. Set `participants` from whoever speaks in the transcript — a plain ' +
            'name is fine where there is no person page, and it becomes one on the page in a click. If the material ' +
            'genuinely names nobody, say so with `participants_unknown: true` and propose it again.',
        );
      }

      const sources = [...refs, ...(params.sources ?? [])];
      const check = validateEvidence(sources, resolves, { inference: !!params.inference });
      if (!check.ok) return text(`Rejected: ${check.reason}`);

      // `## Notes` stays empty above the summary: it is the PM's half of the
      // page, and a meeting they open later has somewhere to write.
      const body = `## Notes\n\n## Summary\n\n${params.summary.trim()}\n`;
      const rec = createProposal(ctx, {
        kind: 'note',
        sessionId,
        skill: harness?.activeSkillName,
        targetPath: path,
        baseHash: null,
        payload: {
          path,
          frontmatter: {
            type: 'meeting',
            title: title.slice(0, 200),
            summary: title.slice(0, 200),
            date: params.date,
            // Born read: the summary is in the body, so nothing is waiting to
            // be done to this page.
            processing: 'processed',
            transcript: refs.length === 1 ? refs[0]! : refs,
            ...(params.participants?.length ? { participants: params.participants } : {}),
            ...(params.customer?.trim() ? { customer: params.customer.trim() } : {}),
            ...(params.tags?.length ? { tags: params.tags } : {}),
          },
          body,
          rationale: params.rationale,
        },
        rationale: params.rationale,
        evidence: evidenceRows(sources),
        inference: !!params.inference,
      });
      harness?.recordWrite(path, rec.id, 'note');
      return text(
        `Proposed meeting (${rec.id}): ${path}, with the summary in it. Cite it as ` +
          `"[[${path.replace(/\.md$/, '')}]]" on the other cards from this meeting — a card may rest on one that is ` +
          `still waiting, so the todos and decisions point at the meeting rather than at the raw recording.` +
          (params.participants_unknown && !params.participants?.length
            ? ' Nobody is on it: say so in your closing line, so the PM knows to add them.'
            : ''),
      );
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
      supersedes: Type.Optional(
        Type.String({ description: 'Slug of the decision this replaces.' }),
      ),
      sources: Type.Optional(Type.Array(Type.String())),
      asked: ASKED_PARAM,
      inference: INFERENCE_PARAM,
    }),
    async execute(_id, params: unknown) {
      const parsed = zDecisionPayload.safeParse(params);
      if (!parsed.success)
        return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const p = params as {
        sources?: string[];
        inference?: boolean;
        asked?: boolean;
        supersedes?: string;
      };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, resolves, {
        inference: !!p.inference,
        asked: !!p.asked,
      });
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      if (p.supersedes && !ctx.index.resolve(stripLink(p.supersedes))) {
        return text(`Rejected: supersedes target not found: ${p.supersedes}`);
      }
      const exists = await alreadyOnDisk(parsed.data.path);
      if (exists) return exists;
      const fm = parsed.data.frontmatter;
      // `acceptDecision` forces the type, so check what it will actually parse.
      const invalid = badFrontmatter({ ...fm, type: 'decision' });
      if (invalid) return invalid;
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
        payload: {
          ...parsed.data,
          ...(p.supersedes ? { supersedes: stripLink(p.supersedes) } : {}),
        },
        rationale: parsed.data.rationale,
        evidence: evidenceRows(sources),
        inference: !!p.inference,
        asked: !!p.asked,
      });
      harness?.recordWrite(parsed.data.path, rec.id, 'decision');
      return text(`Proposed decision (${rec.id}): ${parsed.data.path}. Awaiting review.`);
    },
  });

  const proposeUpdate = defineTool({
    name: 'propose_update',
    label: 'Propose update',
    description:
      "Propose an edit to an EXISTING authored/derived note. Three levers, use any of them together: `patch` = body search/replace blocks for changing text the note ALREADY has (correct a line, extend a list, answer an open question); `append` = text added at the end of the body, for saying something the note does not say yet (a meeting write-up, a `## Prep` section, a new section on a hub); `frontmatter` = a map of metadata keys to set on approval, the ONLY way to change a note's properties (a todo's `due` to reschedule or `commitment`+`resolved` to close it, a meeting's `processing`, a person's `last_told`). Provide at least one. Read the note (vault_read) before you patch it: the search text has to be copied from it word for word and appear only once, and a patch that cannot be found is refused here. A meeting page the calendar made is frontmatter and NO body, so the write-up goes in `append` — there is nothing there to anchor a patch to.",
    parameters: Type.Object({
      path: Type.String(),
      patch: Type.Optional(
        Type.Array(Type.Object({ search: Type.String(), replace: Type.String() })),
      ),
      append: Type.Optional(
        Type.String({
          description:
            'Markdown added at the end of the body, separated by a blank line. Use it for anything the note does not already say — and always on a note with an empty body, where a patch has nothing to match.',
        }),
      ),
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
      asked: ASKED_PARAM,
      inference: INFERENCE_PARAM,
    }),
    async execute(_id, params: unknown) {
      const parsed = zUpdatePayload.safeParse(params);
      if (!parsed.success)
        return text(`Rejected: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
      const target = ctx.index.resolve(stripLink(parsed.data.path));
      if (!target) return text(`Rejected: target note not found: ${parsed.data.path}`);
      const note = await ctx.vault.readNote(target);
      if (!note) return text(`Rejected: cannot read ${target}`);
      // Mutability guards at FILING time (same rules acceptUpdate enforces) —
      // reject where the agent can react, not at approval.
      if ((parsed.data.patch?.length || parsed.data.append?.trim()) && !isBodyEditable(note.type)) {
        const mutable = TYPE_RULES[note.type].mutableFields ?? 'all';
        const allowed =
          mutable === 'all' ? 'frontmatter' : `frontmatter (${[...mutable].join(', ') || 'none'})`;
        const upstream =
          note.type === 'ticket' || note.type === 'wikipage'
            ? ' To change the upstream content, use draft_ticket_comment / draft_page_update instead.'
            : '';
        return text(
          `Rejected: the body of a ${note.type} note is immutable — drop \`patch\`/\`append\`. Only ${allowed} may change here.${upstream}`,
        );
      }
      // The anchor has to be real, checked while the agent is still around to go
      // and look again — the same contract draft_page_update keeps. A
      // patch that cannot be located is not a card that applies badly, it is a
      // card that can never apply at all, and finding that out at review time
      // leaves the PM holding a dead red box with the work inside it.
      if (parsed.data.patch?.length) {
        if (!note.body.trim()) {
          return text(
            `Rejected: ${target} has no body yet, so a patch has nothing to anchor to (a meeting page the calendar made is frontmatter and nothing else). Put the text in \`append\` instead.`,
          );
        }
        if (applyPatch(note.body, parsed.data.patch) === null) {
          return text(
            `Rejected: that search text is not in ${target} as it stands, or it appears there more than once. Read the note again and copy the anchor word for word, with enough around it to be unique — or use \`append\` to add what you have at the end.`,
          );
        }
      }
      if (parsed.data.frontmatter) {
        const merged = {
          ...note.frontmatter,
          ...parsed.data.frontmatter,
        } as typeof note.frontmatter;
        const mutation = checkFrontmatterMutation(note.type, note.frontmatter, merged);
        if (!mutation.allowed) return text(`Rejected: ${mutation.reason}.`);
        // Only what THIS card breaks. A note can already be carrying a field
        // the schema refuses (an old vault, a hand-edit), and refusing every
        // update to it would punish the model for something it did not write —
        // and for a field it may well be here to fix.
        if (parseFrontmatter(note.frontmatter).ok) {
          const invalid = badFrontmatter(merged);
          if (invalid) return invalid;
        }
      }
      const p = params as { sources?: string[]; inference?: boolean; asked?: boolean };
      const sources = p.sources ?? [];
      const check = validateEvidence(sources, resolves, {
        inference: !!p.inference,
        asked: !!p.asked,
      });
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
        evidence: evidenceRows(sources),
        inference: !!p.inference,
        asked: !!p.asked,
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
      title: Type.String({
        description:
          'The commitment, concrete and imperative, e.g. "Send Nordkap the SSO rollout dates".',
      }),
      due: Type.Optional(
        Type.String({ description: 'Due date "YYYY-MM-DD", only if named or clearly implied.' }),
      ),
      owner: Type.Optional(
        Type.String({
          description:
            'ONLY for someone else\'s commitment: who owes it — a "[[people/…]]" ref or their name. Omit for the PO\'s own todos.',
        }),
      ),
      quote: Type.Optional(
        Type.String({ description: 'The verbatim line where the commitment was made.' }),
      ),
      sources: Type.Array(
        Type.String({
          description:
            'Wikilinks to where the commitment was made, e.g. "[[meetings/2026-07-08-sprint-planning]]". A commitment the PM makes to you in the conversation has none: send `asked` instead and leave this empty.',
        }),
      ),
      rationale: Type.String(),
      asked: ASKED_PARAM,
      inference: INFERENCE_PARAM,
    }),
    async execute(
      _id,
      params: {
        title: string;
        due?: string;
        owner?: string;
        quote?: string;
        sources: string[];
        rationale: string;
        inference?: boolean;
        asked?: boolean;
      },
    ) {
      const title = params.title.trim();
      if (!title) return text('Rejected: todo needs a title.');
      if (params.due && !/^\d{4}-\d{2}-\d{2}$/.test(params.due)) {
        return text(`Rejected: due must be "YYYY-MM-DD", got "${params.due}".`);
      }
      const sources = params.sources ?? [];
      const check = validateEvidence(sources, resolves, {
        inference: !!params.inference,
        asked: !!params.asked,
      });
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const today = ctx.clock.now().slice(0, 10);
      const path = `todos/${fileSlug(title.slice(0, 200), today)}.md`;
      const exists = await alreadyOnDisk(path);
      if (exists) return exists;
      // The check the tool description has always asked for, now actually
      // possible: a pending card is not a note on disk, so `vault_list` could
      // never see the commitment a concurrent run proposed a minute ago.
      const dup = alreadyProposed({ kind: 'note', targetPath: path, noteType: 'todo', title });
      if (dup) return dup;
      const body = params.quote ? `> ${params.quote.trim()}\n> — ${sources[0] ?? 'source'}\n` : '';
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
        evidence: evidenceRows(sources),
        inference: !!params.inference,
        asked: !!params.asked,
      });
      harness?.recordWrite(path, rec.id, 'note');
      const who = params.owner?.trim() ? ` (waiting on ${params.owner.trim()})` : '';
      return text(`Proposed todo (${rec.id}): ${title}${who}. Awaiting review.`);
    },
  });

  /**
   * A rule the PM stated in passing, made durable (docs/standing-instructions.md).
   *
   * "Remember to create person notes as well" used to get a yes in the chat and
   * change nothing: the next session started from the same prompt as the last
   * one, and the PM had to say it again. The rule belongs in a file the model
   * reads, so it goes where the behavior lives: the skill or agent that owns it,
   * under `## Standing instructions`, or the house rules under `## Your rules`
   * when nothing else fits. Either way it goes through the same approval card as
   * every other write.
   *
   * Nothing new is invented for it. An existing file takes an `update` card with
   * the `append` lever, which cannot miss its anchor the way a patch can; a
   * workspace with no house-rules file yet takes a `note` card that creates one.
   */
  const proposeInstruction = defineTool({
    name: 'propose_instruction',
    label: 'Propose instruction',
    description:
      'Propose a standing instruction: something the PM said should hold from now on, not just in this ' +
      'conversation ("remember to create person notes too", "articles with no project get the inspiration tag"). ' +
      'It lands as a bullet under "Standing instructions" in the skill or agent that owns the behavior, and every ' +
      'session that runs that file reads it from then on. Name `target` when one skill or agent clearly owns it ' +
      '(arrival, librarian, meeting-prep) and leave it out otherwise: the rule then goes under "Your rules" in the ' +
      'house rules, the one document every session reads. Keep `rule` to one short imperative sentence, and keep ' +
      'answering the PM normally in the same turn. Never say you will remember something without this card.',
    parameters: Type.Object({
      rule: Type.String({
        description:
          'The rule, one short imperative sentence, e.g. "When filing material that mentions a person, create their person note too."',
      }),
      target: Type.Optional(
        Type.String({
          description:
            'The skill or agent that owns this behavior, by name ("arrival", "librarian"). Leave it out when no single one does.',
        }),
      ),
      why: Type.Optional(
        Type.String({ description: 'Why the PM wants it, in one line. Shown on the card.' }),
      ),
    }),
    async execute(_id, params: { rule: string; target?: string; why?: string }) {
      const rule = params.rule.replace(/\s+/g, ' ').trim();
      if (!rule) {
        return text('Rejected: say the rule itself, one sentence about what to do from now on.');
      }
      if (rule.length > RULE_MAX) {
        return text(
          `Rejected: that rule is ${rule.length} characters and the cap is ${RULE_MAX}. Compress it to one ` +
            'imperative sentence and leave the reasoning out: it is read at the top of every session it applies to.',
        );
      }

      // A name resolves the way an invocation does — skills before agents, the
      // folder entry before the legacy flat file — so a rule cannot land in a
      // file the session would never open.
      const wanted = params.target?.trim()
        ? ((stripLink(params.target) || params.target.trim())
            .replace(/\.md$/i, '')
            .split('/')
            .filter(Boolean)
            .pop() ?? '')
        : '';
      const read = async (name: string) => {
        for (const path of runnableCandidates(name)) {
          const note = await ctx.vault.readNote(path);
          if (note) return { path, note };
        }
        return null;
      };
      const owner = wanted ? await read(wanted) : null;
      const home = owner ?? (await read(HOUSE_RULES_NAME));
      const name = owner ? wanted : HOUSE_RULES_NAME;
      const missed = wanted && !owner ? wanted : '';
      // Each home files rules under its own heading: a skill or agent collects
      // them as standing instructions, the house rules as the PM's own rules.
      const heading = owner ? RULES_HEADING : HOUSE_RULES_HEADING;

      const label =
        home && typeof home.note.frontmatter['title'] === 'string' && home.note.frontmatter['title']
          ? (home.note.frontmatter['title'] as string)
          : name;
      const lands = owner
        ? `Goes into ${label}'s standing instructions.`
        : 'Goes into Your rules, in the house rules every session reads.';
      const rationale = `${params.why?.trim() || 'You asked for this in chat.'} ${lands}`;
      const headline = `Remember this: ${rule}`;
      // The PM saying it in the chat IS the source, and a message is not a note,
      // so there is nothing to cite: this is the `asked` basis exactly, not the
      // inference one. Nothing here was worked out by the model.
      const chatIsTheSource = { evidence: [], inference: false, asked: true };
      const receipt = (id: string) =>
        text(
          `Proposed instruction (${id}): "${rule}" -> ${name}. Awaiting review.` +
            (missed
              ? ` Nothing is called "${missed}" here, so it goes to the house rules instead of that file.`
              : ''),
        );

      if (home) {
        const already = existingRules(home.note.body, heading).find(
          (bullet) => normalizeRule(bullet) === normalizeRule(rule),
        );
        if (already) {
          return text(
            `Not proposed: that is already a standing instruction there ("${already}"). Nothing was created, ` +
              'and you do not need to do anything about it.',
          );
        }
        // The same rule already on a card. `duplicatePending` compares an update
        // card by what it is FOR, which for these is the rationale rather than
        // the rule, so two different rules with the same "why" would read as one
        // and one rule proposed twice would not. The bullet itself settles both.
        const waiting = ctx.proposals.list('pending').find((rec) => {
          if (rec.kind !== 'update' || rec.targetPath !== home.path) return false;
          const append = (rec.payload as { append?: string } | null)?.append ?? '';
          return existingRules(`${heading}\n${append}`, heading).some(
            (bullet) => normalizeRule(bullet) === normalizeRule(rule),
          );
        });
        if (waiting) {
          return text(
            `Not proposed: a card already waiting on the PM adds that same rule (${waiting.id}). Nothing was ` +
              'created, and you do not need to do anything about it.',
          );
        }
        const dup = alreadyProposed({ kind: 'update', targetPath: home.path, title: rule });
        if (dup) return dup;
        // Approval trims the append and re-joins it with a blank line, so the
        // leading newlines here are only what the text reads as on the card.
        const append = rulesSectionIsLast(home.note.body, heading)
          ? `\n- ${rule}`
          : `\n\n${heading}\n\n- ${rule}`;
        const rec = createProposal(ctx, {
          kind: 'update',
          sessionId,
          skill: harness?.activeSkillName,
          targetPath: home.path,
          baseHash: contentHash(home.note.body),
          payload: { path: home.path, append, rationale, headline },
          rationale,
          ...chatIsTheSource,
        });
        harness?.recordWrite(home.path, rec.id, 'update');
        return receipt(rec.id);
      }

      // No house-rules file at all: the card writes the shipped document with
      // the new rule at the end of it. The whole document, not just the rule —
      // the runtime falls back to this same text while the file is missing, so
      // a card that wrote the bullet alone would silently drop the language,
      // writing and filing rules the session had a moment ago.
      const shipped = parseRunnable(HOUSE_RULES, HOUSE_RULES_NAME);
      const path = runnableEntryPath('skills', HOUSE_RULES_NAME);
      const dup = alreadyProposed({
        kind: 'note',
        targetPath: path,
        noteType: 'skill',
        title: shipped.title,
      });
      if (dup) return dup;
      const rec = createProposal(ctx, {
        kind: 'note',
        sessionId,
        skill: harness?.activeSkillName,
        targetPath: path,
        baseHash: null,
        payload: {
          path,
          frontmatter: {
            type: 'skill',
            title: shipped.title,
            summary: shipped.summary,
          },
          body: `${shipped.body.trim()}\n\n- ${rule}`,
          rationale,
          headline,
        },
        rationale,
        ...chatIsTheSource,
      });
      harness?.recordWrite(path, rec.id, 'note');
      return receipt(rec.id);
    },
  });

  return [
    proposeNote,
    proposeMeeting,
    proposeUpdate,
    proposeDecision,
    proposeTodo,
    proposeInstruction,
  ];
}

/**
 * Take a card back.
 *
 * The queue was write-only from the agent's side: every propose_* and draft_*
 * added, and nothing could ever subtract. So the one thing a session could do
 * with a card it now knew was wrong was propose a second card beside it and
 * leave the PM to work out that the first was dead. Correcting one fact would
 * hand them four cards where they should have had two.
 *
 * The tool is deliberately not a reject. Withdrawing is the session saying
 * "ignore what I said"; deciding is the PM's, and a card they already approved
 * or discarded stays exactly as they left it (the use case refuses, and says
 * which). Nothing is written either way — a withdrawn card was never a note.
 */
export function createWithdrawTool(
  ctx: UseCaseContext,
  sessionId: string,
  harness?: SessionHarness,
): ToolDefinition {
  return defineTool({
    name: WITHDRAW_TOOL_NAME,
    label: 'Withdraw card',
    description:
      'Take back cards you proposed in this session that the PM has not decided yet — they disappear from the review queue and nothing is written. ' +
      'Use it the moment a card turns out to be wrong: the PM corrects a fact it rests on, you read something that changes it, or you are about to propose a replacement. ' +
      'Withdraw the wrong card FIRST, then propose the corrected one, so the PM is left holding one card instead of two. ' +
      'A card they already approved cannot be withdrawn — it is a note now, so propose_update it — and one they discarded is already gone.',
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        description: 'Card ids, as the propose/draft tool reported them, e.g. ["p_abc123_def"].',
      }),
      reason: Type.String({
        description:
          'Why, in one line, in the PM\'s terms ("wrong domain, they corrected it to qale.ai").',
      }),
    }),
    async execute(_id, params: { ids: string[]; reason: string }) {
      const ids = params.ids.map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) return text('Rejected: name at least one card id to withdraw.');
      // Required, and it goes nowhere but this call — which is the point: the
      // step is right there in the session trail, so a card that vanishes from
      // the PM's queue has a reason next to it in the PM's own words.
      if (!params.reason.trim()) {
        return text(
          'Rejected: say why you are taking it back — the PM sees this step and the card disappearing from their queue.',
        );
      }
      const gone: string[] = [];
      const kept: string[] = [];
      for (const id of ids) {
        const result = withdrawProposal(ctx, id, sessionId);
        if (result.ok) {
          // The receipt records what a session DID, and this one undid it.
          harness?.dropWrite(id);
          gone.push(id);
        } else kept.push(result.error ?? `${id} could not be withdrawn`);
      }
      const lines: string[] = [];
      if (gone.length > 0) {
        lines.push(
          `Withdrawn (${gone.join(', ')}). ${gone.length === 1 ? 'That card is' : 'Those cards are'} out of the PM's queue and nothing was written. ` +
            'If a corrected version should take its place, propose it now.',
        );
      }
      // Named one by one: "2 of 3 failed" is the kind of summary that gets read
      // as "close enough" and moved past, and each of these needs a different
      // next move (update the note vs. leave it alone).
      for (const line of kept) lines.push(`Not withdrawn: ${line}.`);
      return text(lines.join('\n'));
    },
  });
}

/** One take on a piece of text: what its tab says, and the whole text under it. */
interface Variant {
  label: string;
  body: string;
}

/** Drop the empties and trim; a tab with no body is not a variant. */
function cleanVariants(raw: { label?: string; body?: string }[] | undefined): Variant[] {
  return (raw ?? [])
    .map((v, i) => ({
      label: (v?.label ?? '').trim() || `Take ${i + 1}`,
      body: (v?.body ?? '').trim(),
    }))
    .filter((v) => v.body.length > 0);
}

export const GET_VOICE_TOOL_NAME = 'get_voice';
export const DRAFT_TEXT_TOOL_NAME = 'draft_text';

/**
 * The drafting tools that write into a tracker or a wiki. Two permissions in
 * series: `can: [draft-outbound]` on the skill, and a connector on the
 * workspace (see `toolNamesFor`).
 *
 * The names carry no product (PD-9). A tool name was how the model used to pick
 * a provider, which made every skill file name Jira, and made a second tracker
 * a second tool. The handler resolves the provider now, from the container or
 * from the mirror the draft is addressed to.
 */
export const DRAFT_TOOL_NAMES = ['draft_ticket', 'draft_ticket_comment', 'draft_page_update'];

/**
 * The drafting tools that write into a calendar, gated apart on
 * `can: [draft-calendar]` and the same connector floor.
 *
 * A ticket comment answers somebody who is already reading the ticket. An event
 * puts a time in other people's days, and the guests see it whether or not they
 * asked. One skill in the workspace books meetings, so the other outbound
 * skills carried three tool schemas they never called.
 *
 * Disjoint from {@link DRAFT_TOOL_NAMES} by construction: one list per gate, and
 * no tool nameable from two of them, or a session could be handed a tool by a
 * capability it was not granted.
 */
export const CALENDAR_TOOL_NAMES = [
  'draft_calendar_event',
  'draft_calendar_reschedule',
  'draft_calendar_rsvp',
];

/** What a voice asked for resolves to: the voice, or the refusal to hand back. */
export type VoiceCheck = { ok: true; voice: Voice | null } | { ok: false; text: string };

/**
 * One session's voice discipline, shared by every tool that writes text.
 *
 * It is built once per session because the "have you read this?" set is the
 * whole mechanism: `get_voice` is one tool, and a second copy of it with a
 * second set would let a voice count as read for one tool and unread for the
 * next one in the same turn.
 */
export interface VoiceGate {
  /** The names the model may pass, as a tool description says them. */
  roster: string;
  /** The one sentence about voice each drafting description ends with. */
  voiceNote: string;
  /** Resolve the voice a draft asks for, or refuse it. */
  forVoice(name: string | undefined): Promise<VoiceCheck>;
  /** The `get_voice` tool itself, handed to the session by `createTextTools`. */
  getVoice: ToolDefinition;
}

/**
 * Build the voice gate for a session (SK-6).
 *
 * @param voices The workspace's voices, read once when the session opens. They
 * are only in the tool DESCRIPTIONS here, so the model knows which names exist;
 * the brief itself is fetched at drafting time by `get_voice`.
 */
export function createVoiceGate(
  ctx: UseCaseContext,
  voices: Voice[] = [],
  harness?: SessionHarness,
): VoiceGate {
  const roster = voiceRoster(voices);

  /**
   * The voices this session has actually read. A drafting tool is handed
   * FINISHED text, so the only moment a brief can change how the draft sounds
   * is before the text is written — which means the check has to be "have you
   * read this?", asked when the draft arrives. A draft naming an unread voice
   * is refused once, with the brief attached, and the model writes it again in
   * that voice. Refusing twice would be theatre, so the brief handed over in
   * the refusal counts as read.
   */
  const briefed = new Set<string>();

  /**
   * Resolve the voice a draft asks for. Three answers: no voice asked for
   * (draft plain), a voice that does not exist (refuse, and never substitute
   * one), and a voice whose brief this session has not seen yet (refuse once,
   * with the brief).
   *
   * A draft that names no voice is never refused. Which voice fits, or whether
   * one fits at all, is a judgement about who is going to read the text, and
   * the roster in every drafting description is where that judgement is
   * informed. A gate that refused plain drafts would answer a question of fit
   * with a rule, and the wrong answer would be unappealable.
   */
  const forVoice = async (name: string | undefined): Promise<VoiceCheck> => {
    const wanted = name?.trim();
    if (!wanted) return { ok: true, voice: null };
    const voice = await resolveVoice(ctx, wanted);
    if (!voice) {
      return {
        ok: false,
        text: `Rejected: there is no voice called "${wanted}". ${roster}`,
      };
    }
    if (!briefed.has(voice.name)) {
      briefed.add(voice.name);
      return {
        ok: false,
        text:
          `Rejected: this draft says it is in the ${voice.name} voice, but you have not read that brief yet. ` +
          'Here it is. Write the draft again so it follows every line of it, then call this tool.\n\n' +
          voiceBrief(voice),
      };
    }
    return { ok: true, voice };
  };

  /**
   * Read a voice before drafting in it. Deliberately a tool rather than a block
   * in the system prompt: a session that never drafts never sees a word of
   * tone guidance, and a session that drafts twice in two voices gets each one
   * at the moment it applies.
   */
  const getVoice = defineTool({
    name: GET_VOICE_TOOL_NAME,
    label: 'Read a voice',
    description:
      'Read how a draft in a given voice should sound, before you write it. ' +
      'A voice governs tone, register and wording, never what the draft says. ' +
      `${roster} ` +
      'Call this first whenever a draft is going out in a voice, then write the draft to the brief it hands back.',
    parameters: Type.Object({
      name: Type.String({ description: 'The voice name, e.g. "exec".' }),
    }),
    async execute(_id, params: { name: string }) {
      const voice = await resolveVoice(ctx, params.name);
      if (!voice) return text(`There is no voice called "${params.name}". ${roster}`);
      briefed.add(voice.name);
      harness?.recordRead(voice.path);
      return text(voiceBrief(voice));
    },
  });

  const voiceNote =
    `\`voice\`: how it should sound. ${roster} ` +
    'Read the one you pick with `get_voice` before you write, follow it, and name it here so the draft says which voice it is in. ' +
    'A draft naming a voice you have not read is refused.';

  return { roster, voiceNote, forVoice, getVoice };
}

/**
 * The two tools every session gets, whatever it may write (see `toolNamesFor`).
 *
 * `draft_text` shows text in the chat and files nothing, and `get_voice` reads a
 * file the workspace already holds. Neither needs a capability, and neither can
 * fail for want of a connector, so gating them only ever meant a plain chat was
 * told to draft with a tool it had not been handed.
 *
 * Deliberately apart from {@link createDraftTools}: every line of that factory
 * is citation, staleness and card bookkeeping, and a panel in the chat has none
 * of those. The one thing they share is the voice gate, which is passed in.
 */
export function createTextTools(gate: VoiceGate): ToolDefinition[] {
  const draftText = defineTool({
    name: DRAFT_TEXT_TOOL_NAME,
    label: 'Draft text',
    description:
      'Write one or more takes on a piece of text and show them in the chat, as tabs the PM can compare and copy. ' +
      'It may be a message they will send, but it may as well be a headline, a jingle, a paragraph for a deck. ' +
      'Nothing is sent, nothing is filed and there is nothing to approve: this tool only puts the text in front of them. ' +
      'Use it whenever the answer IS a piece of text to use somewhere, so it arrives with tabs and a Copy button instead of buried in the reply. ' +
      'Give `variants` as a list of {label, body}: the label is what the tab says ("Short", "Warmer"), the body is the whole text in markdown, never a fragment. ' +
      'Write two variants as a rule, so there is something to compare: two real takes on the same text, ' +
      'apart in length or shape or warmth, and each one you would be happy to send. The same text reworded is not a second take. ' +
      'One variant only when a second would be a copy of the first: a one-line answer, or a rewrite where they already said what to change. ' +
      'Optional `title`: a heading for the panel, e.g. "Exec update". ' +
      'Every call draws a new panel, so a revision is another call with the new text, not an edit of the last one. ' +
      'Optional `action`: it renames the Use button and adds your own sentence to the message it sends, so ' +
      '{ label: "Post on PAY-142", message: "Post it as a comment on PAY-142." } comes back to you as an ordinary turn asking for exactly that. ' +
      'Leave it out and the button says "Use this" and sends only which version they picked. ' +
      gate.voiceNote,
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: 'A heading for the panel.' })),
      voice: Type.Optional(
        Type.String({
          description:
            'A voice name from this workspace, e.g. "exec". Set it whenever you read a brief for this draft.',
        }),
      ),
      variants: Type.Array(
        Type.Object({
          label: Type.String({ description: 'What the tab says. Two or three words.' }),
          body: Type.String({ description: 'The whole text, in markdown.' }),
        }),
        {
          description:
            'Two as a rule, one when a second would say the same thing. Each is a complete piece of text, not a fragment.',
        },
      ),
      action: Type.Optional(
        Type.Object(
          {
            label: Type.String({ description: 'What the button says, e.g. "Post on PAY-142".' }),
            message: Type.String({
              description:
                'The sentence sent with the pick, e.g. "Post it as a comment on PAY-142."',
            }),
          },
          { description: 'Rename the Use button and say what clicking it asks you for.' },
        ),
      ),
    }),
    async execute(
      _id,
      params: {
        title?: string;
        voice?: string;
        variants: { label: string; body: string }[];
        action?: { label: string; message: string };
      },
    ) {
      const variants = cleanVariants(params.variants);
      if (variants.length === 0) {
        return text(
          'Rejected: give at least one variant, each with a label for its tab and the whole text as its body.',
        );
      }
      const spoken = await gate.forVoice(params.voice);
      if (!spoken.ok) return text(spoken.text);
      // No card, no record, no receipt: the panel renders from this call's own
      // input, so there is nothing to report but what the PM can now see.
      return text(
        `Showed ${variants.length === 1 ? '1 version' : `${variants.length} versions`} in the chat: ` +
          `${variants.map((v) => v.label).join(', ')}. Nothing was filed and nothing was sent. ` +
          'If they pick one they will say so.',
      );
    },
  });

  return [draftText, gate.getVoice];
}

/**
 * One place a draft can be addressed: a tracker project, a wiki space. The
 * provider comes with it, and that is what lets the write tools stay
 * provider-blind. The model picks a container, the handler picks the provider.
 */
export interface OutboundContainer {
  /** The key the model names, e.g. "PAY". */
  id: string;
  /** What the workspace calls it, for the retry message on an unknown key. */
  name: string;
  kind: 'ticket' | 'wikipage';
  /** The provider string stamped on a card addressed here, e.g. 'jira'. */
  provider: string;
}

/** Every container the workspace reads, injected by the host for the same
 *  reason as {@link TrackExternal}: it is sync state, not a provider call. */
export type ListOutboundContainers = () => OutboundContainer[];

/**
 * Outbound draft tools (PLAN-V2 §3.4): the agent DRAFTS, the human approves.
 * These only ever create outbound cards; the write upstream happens in the
 * card-application layer on approval. There is no auto-apply path here, ever.
 *
 * No tool here names a product (PD-9). The payloads carry a `provider`, and the
 * handler is what puts it there: from the container for a create, from the
 * addressed mirror's frontmatter for a comment or a page edit. `system` is
 * written alongside as a deprecated mirror of `provider` so payload readers from
 * the pre-genericization era keep working.
 *
 * One factory for both {@link DRAFT_TOOL_NAMES} and {@link CALENDAR_TOOL_NAMES},
 * though they are gated apart: they share the citation check, the voice check
 * and the staleness snapshot, and splitting the factory would fork all three to
 * express a permission the caller already decides. Which of them a session may
 * ACTIVATE is `toolNamesFor`'s answer, not this one's.
 */
export function createDraftTools(
  ctx: UseCaseContext,
  sessionId: string,
  harness?: SessionHarness,
  /** The session's voice gate, shared with `draft_text` (see `createVoiceGate`). */
  gate: VoiceGate = createVoiceGate(ctx, [], harness),
  /** Where drafts may be addressed. Empty means nothing is followed yet, which
   *  the tools report as such instead of filing a card that cannot land. */
  listContainers: ListOutboundContainers = () => [],
): ToolDefinition[] {
  // Same rule as the propose tools: a draft may rest on a card still waiting.
  // Citing the meeting on a todo and being refused for it on the comment about
  // that same meeting would be arbitrary from where the model sits.
  const { resolves, evidenceRows } = citations(ctx);
  const { forVoice, voiceNote } = gate;

  /**
   * The sentence that carries text the PM has already read into a real
   * destination. "Post that as a comment on the ticket" is one move, not a
   * rewrite: the version they have open is the text they liked, so it is copied
   * here word for word rather than written again.
   */
  const fromDraftNote =
    'When the PM points at a version you showed with `draft_text` ("post that as a comment"), take that body word for word and send it here. Do not rewrite it.';

  const voiceParam = Type.Optional(
    Type.String({
      description: 'A voice name from this workspace, e.g. "exec". Leave it out to write plainly.',
    }),
  );

  /**
   * Drafted-against snapshot (the staleness baseline): when the target has a
   * mirror note, stamp the mirror's `remote_updated` (and `version` for pages)
   * into the payload at draft time. Accept compares these against the live
   * mirror and refuses when the upstream item moved since drafting. No mirror
   * ⇒ no snapshot fields.
   */
  const mirrorFor = (type: 'ticket' | 'wikipage' | 'meeting', ref: string) => {
    const wanted = ref.trim().toLowerCase();
    const mirrors = ctx.index.listByType(type);
    const byId = mirrors.find(
      (n) =>
        String(n.frontmatter['external_id'] ?? '')
          .trim()
          .toLowerCase() === wanted,
    );
    if (byId) return byId;
    // The model may point at the note instead of the id: it reads
    // `[[tickets/PAY-142]]` all over the workspace, so refusing that form would
    // be refusing the address the model actually has.
    const path = ctx.index.resolve(stripLink(ref));
    return (path ? mirrors.find((n) => n.path === path) : null) ?? null;
  };
  type Mirror = ReturnType<typeof mirrorFor>;

  /** The tracker container the model named, by key or by the name shown for it. */
  const containerFor = (named: string): OutboundContainer | null => {
    const wanted = named.trim().toLowerCase();
    const known = listContainers().filter((c) => c.kind === 'ticket');
    return (
      known.find((c) => c.id.toLowerCase() === wanted) ??
      known.find((c) => c.name.toLowerCase() === wanted) ??
      null
    );
  };

  /** The refusal for a container nobody reads. Naming the ones the workspace
   *  does read is the whole message: the model retries from it. */
  const unknownContainer = (named: string): string => {
    const known = listContainers().filter((c) => c.kind === 'ticket');
    if (known.length === 0) {
      return 'Rejected: this workspace follows no tracker project yet, so a new ticket has nowhere to go. Say so, and leave the work as a todo.';
    }
    const list = known.map((c) => `${c.id} (${c.name})`).join(', ');
    return `Rejected: nothing here is called ${named}. This workspace files tickets in ${list}. Pick one of those.`;
  };

  /** The one provider that holds this kind of item, when only one does. Two of
   *  them and an unmirrored id is genuinely ambiguous, so nobody guesses. */
  const soleProvider = (kind: 'ticket' | 'wikipage'): string | null => {
    const providers = [
      ...new Set(
        listContainers()
          .filter((c) => c.kind === kind)
          .map((c) => c.provider),
      ),
    ];
    return providers.length === 1 ? (providers[0] ?? null) : null;
  };

  /**
   * Who to stamp on a draft addressed to an existing item. The mirror note is
   * the authority: its frontmatter names the provider that holds the item, so
   * the model points at the thing and never types a product name. Nothing
   * mirrored yet ⇒ the workspace's only provider for the kind, or nothing.
   */
  const providerFor = (kind: 'ticket' | 'wikipage', mirror: Mirror): string | null => {
    const named = mirror ? String(mirror.frontmatter['provider'] ?? '').trim() : '';
    return named || soleProvider(kind);
  };

  /** The refusal when no mirror and no single provider can say who holds it. */
  const unknownTarget = (kind: 'ticket' | 'wikipage', ref: string): string =>
    `Rejected: nothing here says which system holds ${ref}, so the draft has no address. ` +
    (kind === 'ticket'
      ? 'Watch it with `track_external` first, then draft against the mirror it makes.'
      : 'Cite the page by the id on its mirror note in wikipages/.');
  const draftSnapshot = (
    type: 'ticket' | 'wikipage' | 'meeting',
    externalId: string,
  ): { remote_updated?: string; version?: number } => {
    const mirror = mirrorFor(type, externalId);
    if (!mirror) return {};
    const out: { remote_updated?: string; version?: number } = {};
    const ru = mirror.frontmatter['remote_updated'];
    if (typeof ru === 'string' && ru) out.remote_updated = ru;
    const v = mirror.frontmatter['version'];
    if (type === 'wikipage' && typeof v === 'number' && Number.isInteger(v) && v >= 0)
      out.version = v;
    return out;
  };
  const mkCard = (
    payload: Record<string, unknown>,
    rationale: string,
    sources: string[],
    label: string,
  ) => {
    const rec = createProposal(ctx, {
      kind: 'outbound',
      sessionId,
      skill: harness?.activeSkillName,
      targetPath: null,
      baseHash: null,
      payload,
      rationale,
      evidence: evidenceRows(sources),
      inference: false,
    });
    harness?.recordWrite(String(payload['linkBackPath'] ?? label), rec.id, 'outbound');
    return rec;
  };

  const draftTicket = defineTool({
    name: 'draft_ticket',
    label: 'Draft a tracker ticket',
    description:
      'Draft a NEW ticket as an approval card (never created until approved). `container` is the project or team it goes in, named by its key; the card shows which tracker that is. Give a title and a markdown body ending with a provenance line ("Source: <meeting>, <date>"). Cite sources[] (the meeting or decision it came from). Optionally linkBack: a workspace note path to append the created ticket\'s link to on approval. ' +
      voiceNote,
    parameters: Type.Object({
      container: Type.String({
        description: 'The project or team the ticket goes in, by its key, e.g. "PAY".',
      }),
      kind: Type.Optional(
        Type.String({ description: "bug, task, story: the tracker's own type names." }),
      ),
      title: Type.String(),
      body: Type.String(),
      voice: voiceParam,
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(
      _id,
      params: {
        container: string;
        kind?: string;
        title: string;
        body: string;
        voice?: string;
        sources: string[];
        linkBack?: string;
        rationale: string;
      },
    ) {
      const check = validateEvidence(params.sources ?? [], resolves);
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      // The container decides the provider, so an unknown one is not a detail
      // to fix at approval: there is nothing to address the card to.
      const container = containerFor(params.container);
      if (!container) return text(unknownContainer(params.container));
      const spoken = await forVoice(params.voice);
      if (!spoken.ok) return text(spoken.text);
      const rec = mkCard(
        {
          provider: container.provider,
          system: container.provider,
          action: 'create_ticket',
          voice: spoken.voice?.name,
          container: container.id,
          issueType: params.kind,
          title: params.title,
          body: params.body,
          linkBackPath: params.linkBack,
          rationale: params.rationale,
        },
        params.rationale,
        params.sources,
        'ticket',
      );
      return text(`Drafted a ticket card (${rec.id}) in ${container.id}. Awaiting approval.`);
    },
  });

  const draftTicketComment = defineTool({
    name: 'draft_ticket_comment',
    label: 'Draft a ticket comment',
    description:
      'Draft a comment on an existing ticket as an approval card. `ticket` is the item itself: its key (PAY-142) or its mirror note (tickets/PAY-142). Take the key from the mirror note (tickets/, frontmatter external_id) when one exists, and cite that mirror in sources[] alongside the meeting or decision. The card shows which tracker it goes to. End the body with a provenance line ("Source: <meeting>, <date>"). ' +
      voiceNote +
      ' ' +
      fromDraftNote,
    parameters: Type.Object({
      ticket: Type.String({ description: 'The ticket key, or the path of its mirror note.' }),
      body: Type.String(),
      voice: voiceParam,
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(
      _id,
      params: {
        ticket: string;
        body: string;
        voice?: string;
        sources: string[];
        linkBack?: string;
        rationale: string;
      },
    ) {
      const check = validateEvidence(params.sources ?? [], resolves);
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const mirror = mirrorFor('ticket', params.ticket);
      const provider = providerFor('ticket', mirror);
      if (!provider) return text(unknownTarget('ticket', params.ticket));
      const spoken = await forVoice(params.voice);
      if (!spoken.ok) return text(spoken.text);
      // The key upstream, never the note path: the connector addresses the
      // provider's own id, and a mirror is the one place that holds it.
      const targetId = mirror
        ? String(mirror.frontmatter['external_id'] ?? '').trim()
        : params.ticket.trim();
      const rec = mkCard(
        {
          provider,
          system: provider,
          action: 'comment_ticket',
          voice: spoken.voice?.name,
          targetId,
          body: params.body,
          linkBackPath: params.linkBack,
          rationale: params.rationale,
          ...draftSnapshot('ticket', targetId),
        },
        params.rationale,
        params.sources,
        'ticket-comment',
      );
      return text(`Drafted a comment card (${rec.id}) on ${targetId}. Awaiting approval.`);
    },
  });

  const draftPageUpdate = defineTool({
    name: 'draft_page_update',
    label: 'Draft a page update',
    description:
      'Draft a change to a wikipage as an approval card. There are two ways to change a page; pick the one that fits. With `patch` (search + replace) that ONE passage is rewritten in place on the live page and the rest of it is left untouched, which is what you want when the page now says something wrong. The search text must be copied word for word from the page as it stands, with enough of it around the change that it appears only once. Anchor it on a plain run of prose, never on a line carrying markup (a **bold** span, a `- ` bullet, a `## ` heading, a [text](url) link): here it is checked against the page\'s mirror note, which is markdown, but on approval it is matched against the live page, where that markup is not written the same way, and the edit fails then with "the page\'s text changed". Give `provenance` with a patch: the redline is only the corrected sentence, so that one line ("Source: <origin>, <date>") is how the page says where the change came from. Without a patch, `body` is appended to the page as a new section, which is what you want when you are adding something the page does not say yet; end it with a provenance line of its own and leave the `provenance` field out, because the page gets that line as written and a second one would be added underneath. `page` is the page itself: its id, or its mirror note (wikipages/…). Cite that mirror in sources[] when one exists. The card shows which wiki it goes to. ' +
      voiceNote +
      ' ' +
      fromDraftNote,
    parameters: Type.Object({
      page: Type.String({ description: 'The page id, or the path of its mirror note.' }),
      voice: voiceParam,
      body: Type.Optional(
        Type.String({
          description: 'The new section to append. Leave it out when you are patching a passage.',
        }),
      ),
      patch: Type.Optional(
        Type.Object(
          {
            search: Type.String({
              description:
                "The passage to replace, word for word from the page's own text. Pick a run of plain prose, not a line carrying markup.",
            }),
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
    async execute(
      _id,
      params: {
        page: string;
        voice?: string;
        body?: string;
        patch?: { search: string; replace: string };
        provenance?: string;
        sources: string[];
        linkBack?: string;
        rationale: string;
      },
    ) {
      const check = validateEvidence(params.sources ?? [], resolves);
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const mirror = mirrorFor('wikipage', params.page);
      const provider = providerFor('wikipage', mirror);
      if (!provider) return text(unknownTarget('wikipage', params.page));
      const targetId = mirror
        ? String(mirror.frontmatter['external_id'] ?? '').trim()
        : params.page.trim();
      const spoken = await forVoice(params.voice);
      if (!spoken.ok) return text(spoken.text);
      // A redline has to produce both halves: the whole page as it will read,
      // which is what the card previews, and the localized edit, which is what
      // the push applies. Building the preview here instead of asking for it
      // also proves the passage really is on the page, while the agent is still
      // around to go and look again.
      let body = params.body?.trim() ? params.body : null;
      if (params.patch) {
        const note = mirror ? await ctx.vault.readNote(mirror.path) : null;
        if (!mirror || !note) {
          return text(
            `Rejected: there is no wikipage mirror for ${params.page}, so the passage cannot be checked against what the page says. Append a section with \`body\` instead.`,
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
        return text(
          'Rejected: give a `patch` to rewrite a passage in place, or a `body` to append as a new section.',
        );
      }
      const rec = mkCard(
        {
          provider,
          system: provider,
          action: 'update_page',
          voice: spoken.voice?.name,
          targetId,
          body,
          ...(params.patch ? { patch: params.patch } : {}),
          ...(params.provenance?.trim() ? { provenance: params.provenance.trim() } : {}),
          linkBackPath: params.linkBack,
          rationale: params.rationale,
          ...draftSnapshot('wikipage', targetId),
        },
        params.rationale,
        params.sources,
        'page-update',
      );
      const what = params.patch ? 'a page redline card' : 'a page update card';
      return text(`Drafted ${what} (${rec.id}) on page ${targetId}. Awaiting approval.`);
    },
  });

  const draftCalendarEvent = defineTool({
    name: 'draft_calendar_event',
    label: 'Draft calendar event',
    description:
      'Draft a NEW Google Calendar event as an approval card (never created until approved) — a follow-up meeting, a booked slot. Give a title (the invite summary), a start as RFC3339 with offset (e.g. 2026-08-04T15:00:00+02:00), optionally an end (defaults to +30 min) and attendee emails, and a body used as the invite description ending with a provenance line ("Source: <meeting>, <date>"). calendarId defaults to the primary calendar. Cite sources[]. linkBack: the meeting/todo note to append the created event\'s link to on approval. ' +
      voiceNote,
    parameters: Type.Object({
      title: Type.String(),
      start: Type.String(),
      end: Type.Optional(Type.String()),
      attendees: Type.Optional(Type.Array(Type.String())),
      calendarId: Type.Optional(Type.String()),
      body: Type.String(),
      voice: voiceParam,
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(
      _id,
      params: {
        title: string;
        start: string;
        end?: string;
        attendees?: string[];
        calendarId?: string;
        body: string;
        voice?: string;
        sources: string[];
        linkBack?: string;
        rationale: string;
      },
    ) {
      const check = validateEvidence(params.sources ?? [], resolves);
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const spoken = await forVoice(params.voice);
      if (!spoken.ok) return text(spoken.text);
      const rec = mkCard(
        {
          provider: 'google-calendar',
          system: 'google-calendar',
          action: 'create_event',
          voice: spoken.voice?.name,
          title: params.title,
          start: params.start,
          end: params.end,
          attendees: params.attendees,
          calendarId: params.calendarId,
          body: params.body,
          linkBackPath: params.linkBack,
          rationale: params.rationale,
        },
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
      "Draft a change to an EXISTING calendar event as an approval card — a new time, a new title. eventId is the event's id — take it from the synced meeting note (meetings/, frontmatter external_id) and cite that note in sources[]. Give the new start/end (RFC3339 with offset) and/or title, and a body describing the change. linkBack: the meeting note to append the confirmation to.",
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
    async execute(
      _id,
      params: {
        eventId: string;
        calendarId?: string;
        title?: string;
        start?: string;
        end?: string;
        body: string;
        sources: string[];
        linkBack?: string;
        rationale: string;
      },
    ) {
      const check = validateEvidence(params.sources ?? [], resolves);
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        {
          provider: 'google-calendar',
          system: 'google-calendar',
          action: 'update_event',
          eventId: params.eventId,
          calendarId: params.calendarId,
          title: params.title,
          start: params.start,
          end: params.end,
          body: params.body,
          linkBackPath: params.linkBack,
          rationale: params.rationale,
          ...draftSnapshot('meeting', params.eventId),
        },
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
      "Draft an RSVP to a calendar event on your behalf as an approval card. eventId is the event's id (from the synced meeting note's external_id — cite that note). attendeeEmail is your own calendar email; responseStatus is accepted/declined/tentative. Give a short body explaining the response. linkBack: the meeting note to note the RSVP on.",
    parameters: Type.Object({
      eventId: Type.String(),
      attendeeEmail: Type.String(),
      responseStatus: Type.Union([
        Type.Literal('accepted'),
        Type.Literal('declined'),
        Type.Literal('tentative'),
      ]),
      calendarId: Type.Optional(Type.String()),
      body: Type.String(),
      sources: Type.Array(Type.String()),
      linkBack: Type.Optional(Type.String()),
      rationale: Type.String(),
    }),
    async execute(
      _id,
      params: {
        eventId: string;
        attendeeEmail: string;
        responseStatus: 'accepted' | 'declined' | 'tentative';
        calendarId?: string;
        body: string;
        sources: string[];
        linkBack?: string;
        rationale: string;
      },
    ) {
      const check = validateEvidence(params.sources ?? [], resolves);
      if (!check.ok) return text(`Rejected: ${check.reason}`);
      const rec = mkCard(
        {
          provider: 'google-calendar',
          system: 'google-calendar',
          action: 'respond_to_event',
          eventId: params.eventId,
          attendeeEmail: params.attendeeEmail,
          responseStatus: params.responseStatus,
          calendarId: params.calendarId,
          body: params.body,
          linkBackPath: params.linkBack,
          rationale: params.rationale,
          ...draftSnapshot('meeting', params.eventId),
        },
        params.rationale,
        params.sources,
        'calendar-rsvp',
      );
      return text(
        `Drafted calendar RSVP card (${rec.id}): ${params.responseStatus}. Awaiting approval.`,
      );
    },
  });

  return [
    draftTicket,
    draftTicketComment,
    draftPageUpdate,
    draftCalendarEvent,
    draftCalendarReschedule,
    draftCalendarRsvp,
  ];
}

/**
 * The reads a connection brings, adapted onto the harness (PD-8). Each provider
 * owns its own read tools because search speaks the provider's query language
 * (JQL, CQL), so the names, descriptions and schemas come from the connectors
 * package and this function changes none of them.
 *
 * The origin envelope is applied HERE, not there: the connector names where the
 * text came from, and fencing it is a prompt concern this package owns on both
 * sides (see ./external.ts, which the display paths unwrap with).
 */
export function createReadTools(tools: readonly ProviderReadTool[]): ToolDefinition[] {
  return tools.map((tool) =>
    defineTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
      async execute(_id, params) {
        const result = await tool.execute((params ?? {}) as Record<string, unknown>);
        return text(result.external ? wrapExternal(result.external, result.text) : result.text);
      },
    }),
  );
}

/**
 * The two that change what the workspace SYNCS, gated on `can: [track-external]`
 * over the connection. Neither writes anything upstream, so neither takes an
 * approval card, and that is exactly why they are not reads: `track_external`
 * adds a mirrored note the app keeps up forever, and `follow_container` starts
 * reading a whole project or remembers a "no" for good. Two files do that work.
 * Disjoint from a provider's read tools: one list per gate.
 */
export const TRACK_TOOL_NAMES = ['track_external', 'follow_container'];

/** Start watching an external item locally. Injected by the host because it
 *  touches the sync engine, not a provider client. */
export type TrackExternal = (kind: 'ticket' | 'wikipage', externalId: string) => Promise<boolean>;

/** Record what the PM said about a whole project or space (FL-3). Injected for
 *  the same reason as {@link TrackExternal}: it is sync state, not an API call. */
export type AnswerContainerOffer = (containerId: string, follow: boolean) => Promise<boolean>;

/**
 * The two sync-state tools. They belong to no provider: both call back into the
 * host's sync engine, which decides which connection owns the id.
 */
export function createTrackTools(
  track?: TrackExternal,
  answerOffer?: AnswerContainerOffer,
): ToolDefinition[] {
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

  /**
   * The answer to "should it read this space too?" (FL-3), written down.
   *
   * Both answers matter, and the no matters more: a decline is remembered for
   * good, so the container never comes round again. Without that, a quiet offer
   * becomes a monthly nag about the same space, which is the one way this
   * feature could make the product worse. Following is a READ decision like
   * `track_external` — nothing is written upstream — so it takes no approval
   * card either.
   */
  const followContainer = defineTool({
    name: 'follow_container',
    label: 'Follow project or space',
    description:
      'Record what the user said about following a whole Jira project or Confluence space. ' +
      'Use it only after asking them (ask_user) about a container the worklist raised: pass ' +
      'follow true to start reading it, or false when they said no. A no is remembered for good ' +
      'and that container is never offered again, so never guess on their behalf. Writes nothing ' +
      'to Jira or Confluence.',
    parameters: Type.Object({
      container_id: Type.String({
        description: 'Project key or space key, as the worklist gave it.',
      }),
      follow: Type.Boolean({ description: 'true = start reading it, false = they said no.' }),
    }),
    async execute(_id, params: { container_id: string; follow: boolean }) {
      if (!answerOffer)
        return text('Following projects and spaces is not available in this session.');
      const ok = await answerOffer(params.container_id, params.follow);
      if (!ok)
        return text(`No project or space called ${params.container_id} is on this connection.`);
      return text(
        params.follow
          ? `Now reading ${params.container_id}. Its pages and tickets start syncing straight away.`
          : `Noted: ${params.container_id} stays unread, and it will not be offered again.`,
      );
    },
  });

  return [trackExternal, followContainer];
}

/** Domain's ref parsing, with '' instead of null for plain-string call sites. */
function stripLink(ref: string): string {
  return refToSlug(ref) ?? '';
}
