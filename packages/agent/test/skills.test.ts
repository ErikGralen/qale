import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { parseRunnable } from '@qale/sessions';
import { createProposeTools } from '../src/tools.js';

/**
 * "Turn this into a skill" used to have no answer but the New skill button,
 * which writes an empty draft the PM fills in from memory. `propose_skill`
 * drafts it from the session that just ran and files it as an ordinary `note`
 * card, so what is tested here is where the file lands, what its frontmatter
 * says, and the three things that stop it: a name already in use, a draft its
 * own page would open an error on, and a card already waiting.
 */

const run = (tool: { execute: (...a: never[]) => unknown }, params: unknown) =>
  (
    tool.execute as unknown as (
      id: string,
      p: unknown,
      s?: AbortSignal,
    ) => Promise<{ content: { text: string }[] }>
  )('call-1', params, undefined);

const out = async (tool: unknown, params: unknown) =>
  (await run(tool as { execute: (...a: never[]) => unknown }, params)).content[0]!.text;

interface Filed {
  kind: string;
  targetPath: string | null;
  baseHash: string | null;
  payload: { path: string; frontmatter: Record<string, unknown>; body: string; rationale: string };
  rationale: string;
  asked?: boolean;
  inference: boolean;
}

interface Pending {
  id: string;
  kind: string;
  targetPath: string | null;
  payload: unknown;
  rationale: string;
}

function skillCtx(
  files: Record<string, string> = {},
  pending: Pending[] = [],
): UseCaseContext & { filed: Filed[] } {
  const filed: Filed[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  // The PM asked for the skill, so it lands as it is written
  // (docs/easier-tickets.md E-4). What the card carries is still the subject
  // here, and the fake writes so the accept behind it has somewhere to go.
  const read = (p: string) =>
    files[p]
      ? {
          path: p,
          slug: p.replace(/\.md$/, ''),
          type: 'skill',
          frontmatter: { type: 'skill' },
          body: files[p]!,
        }
      : null;
  return {
    vault: {
      readNote: async (p: string) => read(p),
      exists: async (p: string) => !!files[p],
      writeNote: async (p: string, _fm: unknown, body: string) => {
        files[p] = body;
        return read(p)!;
      },
      writeBody: async (p: string, body: string) => {
        files[p] = body;
        return read(p)!;
      },
    },
    index: { resolve: () => null, get: () => null, reindex: () => {} },
    git: { commitPaths: async () => {}, history: async () => [] },
    clock: { now: () => '2026-09-02T09:00:00.000Z' },
    proposals: {
      create: (input: Filed) => {
        const rec = { ...input, id: `p${filed.length + 1}`, status: 'pending', evidence: [] };
        filed.push(input);
        rows.set(rec.id, rec);
        return rec;
      },
      list: (status?: string) => (status === 'pending' ? pending : []),
      get: (id: string) => rows.get(id) ?? null,
      setStatus: (id: string, status: string) => {
        const rec = rows.get(id);
        if (rec) rows.set(id, { ...rec, status });
      },
    },
    filed,
  } as unknown as UseCaseContext & { filed: Filed[] };
}

const tool = (ctx: UseCaseContext) =>
  createProposeTools(ctx, 'session-1').find((t) => t.name === 'propose_skill')!;

const TITLE = 'Weekly roadmap update';
const SUMMARY = 'Writes the Monday roadmap mail from the week that just moved.';
const BODY = `## When

Monday morning, or whenever Erik asks for the roadmap mail.

## Read

The tickets that moved since last Monday, then last week's mail.

## Produce

One draft, in the exec voice, with a line per epic.

## Then

Nothing until it is approved.`;

const PATH = 'skills/weekly-roadmap-update/SKILL.md';

const propose = (ctx: UseCaseContext, extra: Record<string, unknown> = {}) =>
  out(tool(ctx), { title: TITLE, summary: SUMMARY, body: BODY, ...extra });

test('a skill lands at the entry path its name resolves to', async () => {
  const ctx = skillCtx();
  const said = await propose(ctx);

  // The PM asked for it, so it landed rather than queued.
  assert.match(said, new RegExp(`^Applied: Created the skill "${TITLE}"\\.`));
  assert.match(said, new RegExp(`It is at ${PATH}`));
  const card = ctx.filed[0]!;
  // A file, so a `note` card. No sixth proposal kind was invented for it.
  assert.equal(card.kind, 'note');
  assert.equal(card.targetPath, PATH);
  assert.equal(card.payload.path, PATH);
  // Nothing exists yet, so there is no text to write it against.
  assert.equal(card.baseHash, null);
  assert.equal(card.payload.frontmatter['type'], 'skill');
  assert.equal(card.payload.frontmatter['title'], TITLE);
  assert.equal(card.payload.frontmatter['summary'], SUMMARY);
  // The body is the model's, unedited, and the tool composes nothing into it.
  assert.equal(card.payload.body, `${BODY}\n`);
  assert.match(card.rationale, /^You asked for this in chat\./);
  // The PM asked in the chat: a message is not a note, so nothing is cited, and
  // nothing here was worked out by the model either.
  assert.equal(card.asked, true);
  assert.equal(card.inference, false);
});

test('the file is named after the title, and reads back as the skill it will be', async () => {
  const ctx = skillCtx();
  await propose(ctx, {
    title: 'Prep the QBR: Nordkap!',
    scenarios: ['the quarterly review with Nordkap'],
    can: ['keep-working-files'],
  });

  const card = ctx.filed[0]!;
  assert.equal(card.targetPath, 'skills/prep-the-qbr-nordkap/SKILL.md');
  assert.deepEqual(card.payload.frontmatter['scenarios'], ['the quarterly review with Nordkap']);
  assert.deepEqual(card.payload.frontmatter['can'], ['keep-working-files']);
});

test('scenarios and can are left off the frontmatter when there are none', async () => {
  const ctx = skillCtx();
  await propose(ctx, { scenarios: [], can: [] });

  const fm = ctx.filed[0]!.payload.frontmatter;
  assert.equal('scenarios' in fm, false);
  assert.equal('can' in fm, false);
  // What the runtime will read from the file, with nothing flagged on it.
  const parsed = parseRunnable(`---\ntype: skill\n---\n\n${ctx.filed[0]!.payload.body}`, 'x');
  assert.deepEqual(parsed.errors, []);
});

test('a name a skill already answers to is refused, and points at propose_instruction', async () => {
  const ctx = skillCtx({ [PATH]: '# Weekly roadmap update\n' });
  const said = await propose(ctx);

  assert.match(said, /^Not proposed: "weekly-roadmap-update" already exists/);
  assert.match(said, /propose_instruction/);
  assert.equal(ctx.filed.length, 0);
});

/** A name resolves the way an invocation does, so an agent of that name is
 *  taken too: a skill beside it would run instead of the file the PM knows. */
test('an agent of that name is a collision as much as a skill is', async () => {
  const ctx = skillCtx({ 'agents/weekly-roadmap-update/AGENT.md': '# Weekly\n' });
  const said = await propose(ctx);

  assert.match(said, /already exists \(agents\/weekly-roadmap-update\/AGENT\.md\)/);
  assert.equal(ctx.filed.length, 0);

  const legacy = skillCtx({ 'skills/weekly-roadmap-update.md': '# Weekly\n' });
  assert.match(await propose(legacy), /^Not proposed:/);
  assert.equal(legacy.filed.length, 0);
});

/**
 * The frontmatter is composed from the parameters, so a body carrying its own
 * would land as literal text under it. Refused rather than stripped: a `can:`
 * written there is a permission the model meant to ask for.
 */
test('a body that brings its own frontmatter is refused', async () => {
  const ctx = skillCtx();
  const said = await propose(ctx, { body: `---\ntype: skill\ntitle: Weekly\n---\n\n${BODY}` });

  assert.match(said, /^Rejected: leave the frontmatter out of `body`/);
  assert.equal(ctx.filed.length, 0);
});

test('a draft the runtime would flag is refused, in the words the flag uses', async () => {
  const ctx = skillCtx();
  // Instructions that name a tool the permissions do not buy. The file would
  // parse; its own page would just open with the error.
  const said = await propose(ctx, {
    body: `## When\n\nA ticket comes up.\n\n## Read\n\nCall track_external on it.\n`,
  });

  assert.match(said, /^Rejected:/);
  assert.match(said, /track_external/);
  assert.match(said, /track-external/);
  assert.equal(ctx.filed.length, 0);

  // A permission that is not one, for the same reason: an unknown value is
  // dropped by the parser, so the skill would run without the tool it asked for.
  const bad = skillCtx();
  assert.match(await propose(bad, { can: ['read-everything'] }), /^Rejected:/);
  assert.equal(bad.filed.length, 0);
});

test('a title with nothing to name a file with is refused', async () => {
  const ctx = skillCtx();
  assert.match(await propose(ctx, { title: '   ' }), /^Rejected:/);
  assert.match(await propose(ctx, { title: '???' }), /leaves nothing to name the file with/);
  assert.match(await propose(ctx, { summary: '' }), /^Rejected:/);
  assert.match(await propose(ctx, { body: '  \n ' }), /^Rejected:/);
  assert.equal(ctx.filed.length, 0);
});

test('a card already waiting for that file stops a second one', async () => {
  const ctx = skillCtx({}, [
    {
      id: 'p_waiting',
      kind: 'note',
      targetPath: PATH,
      payload: { path: PATH, frontmatter: { type: 'skill', title: TITLE } },
      rationale: 'You asked for this in chat.',
    },
  ]);
  const said = await propose(ctx);

  assert.match(said, /^Not proposed: a proposal already waiting on the PM says the same thing/);
  assert.match(said, /\(p_waiting\)/);
  assert.equal(ctx.filed.length, 0);
});

test('the why the PM gave leads the rationale', async () => {
  const ctx = skillCtx();
  await propose(ctx, { why: 'You write this mail every Monday.' });

  assert.equal(
    ctx.filed[0]!.rationale,
    'You write this mail every Monday. Written from the work in this session.',
  );
});

test('propose_skill is one of the propose tools, on in every session', () => {
  const names = createProposeTools(skillCtx(), 'session-1').map((t) => t.name);
  assert.ok(names.includes('propose_skill'), names.join(', '));
});

/**
 * The two tools sit next to each other, and the one that gets over-reached for
 * is this one: a rule about work an existing skill already covers is a standing
 * instruction, not a second file beside it. Only the cross-tool half is
 * asserted, because the rest is prose that may be reworded.
 */
test('the description sends a rule about existing work to propose_instruction', () => {
  assert.match(tool(skillCtx()).description ?? '', /propose_instruction/);
});
