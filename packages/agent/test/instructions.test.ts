import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import {
  CONFLUENCE_CONVENTIONS,
  HOUSE_RULES,
  JIRA_CONVENTIONS,
  parseRunnable,
} from '@qale/sessions';
import { createProposeTools } from '../src/tools.js';

/**
 * "Remember to create person notes as well" used to get a yes in the chat and
 * change nothing. `propose_instruction` files it as a bullet the next session
 * reads, so what is tested here is where the bullet lands and what stops it:
 * the target the name resolves to, the shape of the append, the file that gets
 * created when no skill owns the rule, and the two ways a rule already said
 * twice is refused.
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
  payload: { path: string; append?: string; body?: string; headline?: string; rationale: string };
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

function rulesCtx(
  files: Record<string, { title?: string; body: string }>,
  pending: Pending[] = [],
): UseCaseContext & { filed: Filed[] } {
  const filed: Filed[] = [];
  const rows = new Map<string, Record<string, unknown>>();
  // A rule lands as it is written (docs/easier-tickets.md E-8), so the fake has
  // to be able to write: what the card carries is still the subject of these
  // tests, and the file it lands in is checked through the same map.
  const read = (p: string) => {
    const note = files[p];
    return note
      ? {
          path: p,
          slug: p.replace(/\.md$/, ''),
          type: 'skill',
          frontmatter: { type: 'skill', ...(note.title ? { title: note.title } : {}) },
          body: note.body,
        }
      : null;
  };
  return {
    vault: {
      readNote: async (p: string) => read(p),
      exists: async (p: string) => !!files[p],
      writeNote: async (p: string, _fm: unknown, body: string) => {
        files[p] = { ...(files[p] ?? {}), body };
        return read(p)!;
      },
      writeBody: async (p: string, body: string) => {
        files[p] = { ...(files[p] ?? {}), body };
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
  createProposeTools(ctx, 'session-1').find((t) => t.name === 'propose_instruction')!;

const RULE = 'When filing a source that mentions a person, create their person note too.';

const ARRIVAL = 'skills/arrival/SKILL.md';
const RULES = 'skills/house-rules/SKILL.md';

/** The house-rules body as it ships: Your rules is the last section of it. */
const HOUSE = parseRunnable(HOUSE_RULES, 'house-rules').body.trim();

test('a rule joins the Standing instructions the target already ends with', async () => {
  const ctx = rulesCtx({
    [ARRIVAL]: {
      title: 'Arrival',
      body: '# Arrival\n\nWhat to do with a source.\n\n## Standing instructions\n\n- Keep the source link.\n',
    },
  });
  const said = await out(tool(ctx), { rule: RULE, target: 'arrival' });

  assert.match(said, /^Applied: Added to rules/);
  const card = ctx.filed[0]!;
  assert.equal(card.kind, 'update');
  assert.equal(card.targetPath, ARRIVAL);
  assert.equal(card.payload.path, ARRIVAL);
  // Just the bullet: the section is the last thing in the file, so an append
  // lands inside it.
  assert.equal(card.payload.append, `\n- ${RULE}`);
  assert.doesNotMatch(card.payload.append!, /## Standing instructions/);
  // Written against the body it read, so a hand edit in between reads as stale.
  assert.ok(card.baseHash);
  assert.equal(card.payload.headline, `Remember this: ${RULE}`);
  assert.match(card.rationale, /^You asked for this in chat\./);
  assert.match(card.rationale, /Goes into Arrival's standing instructions\./);
  // The PM said it: there is no note to cite, and nothing was inferred either.
  assert.equal(card.asked, true);
  assert.equal(card.inference, false);
});

test('a target with no Standing instructions gets the heading with the bullet', async () => {
  const ctx = rulesCtx({ [ARRIVAL]: { title: 'Arrival', body: '# Arrival\n\nWhat to do.\n' } });
  await out(tool(ctx), { rule: RULE, target: 'arrival' });

  assert.equal(ctx.filed[0]!.payload.append, `\n\n## Standing instructions\n\n- ${RULE}`);
});

/**
 * A section a human moved into the middle gets a fresh one at the end rather
 * than a patch: `append` cannot miss its anchor, and a bullet appended to a file
 * that ends in prose would attach itself to the prose.
 */
test('a Standing instructions section that is not last gets a fresh one at the end', async () => {
  const ctx = rulesCtx({
    [ARRIVAL]: {
      body: '## Standing instructions\n\n- Keep the source link.\n\n## Notes\n\nSomething else.\n',
    },
  });
  await out(tool(ctx), { rule: RULE, target: 'arrival' });

  assert.equal(ctx.filed[0]!.payload.append, `\n\n## Standing instructions\n\n- ${RULE}`);
});

test('with no target and no house-rules file, the card writes the whole document', async () => {
  const ctx = rulesCtx({});
  const said = await out(tool(ctx), { rule: RULE });

  assert.match(said, /in house-rules now/);
  const card = ctx.filed[0]!;
  assert.equal(card.kind, 'note');
  assert.equal(card.targetPath, RULES);
  assert.equal(card.baseHash, null);
  const fm = (card.payload as unknown as { frontmatter: Record<string, unknown> }).frontmatter;
  assert.equal(fm['type'], 'skill');
  assert.equal(fm['title'], 'House rules');
  // Nothing declares itself always-on any more: the runtime loads this file by
  // name, so a `starts` key here would be a setting nothing reads.
  assert.equal(fm['starts'], undefined);
  // The shipped document, with the rule at the end of it. The runtime falls
  // back to that same text while the file is missing, so a card that wrote the
  // bullet alone would drop the language, writing and filing rules with it.
  assert.equal(card.payload.body, `${HOUSE}\n\n- ${RULE}`);
  assert.match(card.rationale, /Goes into Your rules, in the house rules every session reads\./);
});

test('a rule with no owner joins Your rules in the house rules', async () => {
  const ctx = rulesCtx({ [RULES]: { title: 'House rules', body: `${HOUSE}\n` } });
  await out(tool(ctx), { rule: RULE });

  const card = ctx.filed[0]!;
  assert.equal(card.kind, 'update');
  assert.equal(card.targetPath, RULES);
  // Your rules is the last heading in the document, so the bullet lands inside
  // it — no second heading, and never under Filing.
  assert.equal(card.payload.append, `\n- ${RULE}`);
});

test('a rule already under Your rules is refused, not filed twice', async () => {
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n\n- ${RULE}\n` } });
  const said = await out(tool(ctx), { rule: RULE });

  assert.match(said, /already a standing instruction there/);
  assert.equal(ctx.filed.length, 0);
});

test('a name nothing answers to falls back to the house rules, and says so', async () => {
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } });
  const said = await out(tool(ctx), { rule: RULE, target: 'meeting-prep' });

  assert.equal(ctx.filed[0]!.targetPath, RULES);
  assert.match(said, /in house-rules now/);
  assert.match(said, /Nothing is called "meeting-prep" here/);
});

test('a skill wins over an agent of the same name, as an invocation does', async () => {
  const ctx = rulesCtx({
    'skills/librarian/SKILL.md': { body: '# Librarian\n' },
    'agents/librarian/AGENT.md': { body: '# Librarian\n' },
  });
  await out(tool(ctx), { rule: RULE, target: '[[skills/librarian]]' });

  assert.equal(ctx.filed[0]!.targetPath, 'skills/librarian/SKILL.md');
});

test('an agent takes the rule when no skill of that name exists', async () => {
  const ctx = rulesCtx({
    'agents/librarian/AGENT.md': { title: 'Librarian', body: '# Librarian\n' },
  });
  const said = await out(tool(ctx), { rule: RULE, target: 'librarian' });

  assert.equal(ctx.filed[0]!.targetPath, 'agents/librarian/AGENT.md');
  assert.match(said, /in librarian now/);
  assert.match(ctx.filed[0]!.rationale, /Goes into Librarian's standing instructions\./);
});

test('a rule the file already carries is refused, whatever the spacing and punctuation', async () => {
  const ctx = rulesCtx({
    [ARRIVAL]: {
      body:
        '## Standing instructions\n\n' +
        '- when filing a source that   mentions a person, create their person note too\n',
    },
  });
  const said = await out(tool(ctx), { rule: RULE, target: 'arrival' });

  assert.match(said, /already a standing instruction there/);
  assert.equal(ctx.filed.length, 0);
});

/**
 * A bullet under a different heading is not a standing instruction, so it must
 * not silence one. Getting this wrong would swallow the rule in a file whose
 * body happens to mention it.
 */
test('a bullet outside the section does not count as one', async () => {
  const ctx = rulesCtx({
    [ARRIVAL]: { body: `## Notes\n\n- ${RULE}\n\n## Standing instructions\n\n- Keep the link.\n` },
  });
  await out(tool(ctx), { rule: RULE, target: 'arrival' });

  assert.equal(ctx.filed.length, 1);
});

test('a card already waiting with the same bullet stops a second one', async () => {
  const ctx = rulesCtx({ [ARRIVAL]: { body: '## Standing instructions\n\n- Keep the link.\n' } }, [
    {
      id: 'p_waiting',
      kind: 'update',
      targetPath: ARRIVAL,
      payload: { path: ARRIVAL, append: `\n- ${RULE}`, rationale: 'You asked for this in chat.' },
      rationale: 'You asked for this in chat.',
    },
  ]);
  const said = await out(tool(ctx), { rule: RULE, target: 'arrival' });

  assert.match(said, /already waiting on the PM adds that same rule \(p_waiting\)/);
  assert.equal(ctx.filed.length, 0);
});

/**
 * Two different rules with the same default "why" are two cards. The pending
 * check compares the bullet, so the one thing it must not do is read them as
 * one because their rationale is identical.
 */
test('a different rule to the same file is still proposed', async () => {
  const ctx = rulesCtx({ [ARRIVAL]: { body: '## Standing instructions\n\n- Keep the link.\n' } }, [
    {
      id: 'p_waiting',
      kind: 'update',
      targetPath: ARRIVAL,
      payload: { path: ARRIVAL, append: `\n- ${RULE}`, rationale: 'You asked for this in chat.' },
      rationale: 'You asked for this in chat.',
    },
  ]);
  const said = await out(tool(ctx), {
    rule: 'Articles with no obvious project land with the tag inspiration.',
    target: 'arrival',
  });

  assert.match(said, /^Applied: Added to rules/);
  assert.equal(ctx.filed.length, 1);
});

test('a rule too long to be one sentence is refused with the cap in it', async () => {
  const ctx = rulesCtx({ [ARRIVAL]: { body: '# Arrival\n' } });
  const said = await out(tool(ctx), { rule: `${'x'.repeat(299)} and more`, target: 'arrival' });

  assert.match(said, /^Rejected:/);
  assert.match(said, /the cap is 300/);
  assert.equal(ctx.filed.length, 0);

  assert.match(await out(tool(ctx), { rule: '   ' }), /^Rejected:/);
  assert.equal(ctx.filed.length, 0);
});

test('the receipt says the rule landed and where it went', async () => {
  const ctx = rulesCtx({ [ARRIVAL]: { title: 'Arrival', body: '# Arrival\n' } });
  const said = await out(tool(ctx), {
    rule: RULE,
    target: 'arrival',
    why: 'Erik asked for it after the Nordkap call.',
  });

  assert.equal(
    said,
    `Applied: Added to rules "${RULE}".\n` +
      'It is in arrival now, and every session that reads that file follows it. Nothing is ' +
      'waiting on the PM: say you have noted it, in one short line, and carry on.',
  );
  assert.match(ctx.filed[0]!.rationale, /^Erik asked for it after the Nordkap call\./);
});

/**
 * The conventions skills (docs/conventions.md CV-3). "Always set the roadmap
 * label on tickets" is a rule ONLY ticket drafting needs, so it must not become
 * a house rule riding in every session prompt. Nothing seeds
 * `skills/jira/SKILL.md`, so the card that files the first such rule is also the
 * card that writes the file.
 */

const JIRA = 'skills/jira/SKILL.md';
const CONFLUENCE = 'skills/confluence/SKILL.md';
const TICKET_RULE = 'Set the label team-checkout on every ticket you draft for NORD.';
const PAGE_RULE = 'Keep the headings a page already has and add under them.';

/** The Jira template as it ships, which is what the creation card writes. */
const JIRA_TEMPLATE = parseRunnable(JIRA_CONVENTIONS, 'jira');

test('a ticket rule with no conventions file yet creates it from the template', async () => {
  // The house rules are right there and are NOT where this lands.
  const ctx = rulesCtx({ [RULES]: { title: 'House rules', body: `${HOUSE}\n` } });
  const said = await out(tool(ctx), { rule: TICKET_RULE, target: 'jira' });

  assert.match(
    said,
    new RegExp(
      `^Applied: Added to rules "${TICKET_RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\.`,
    ),
  );
  assert.match(said, /It is in jira now/);
  // Nothing is missing: "jira" resolved, to a file the card writes.
  assert.doesNotMatch(said, /Nothing is called/);
  const card = ctx.filed[0]!;
  assert.equal(card.kind, 'note');
  assert.equal(card.targetPath, JIRA);
  assert.equal(card.baseHash, null);
  const fm = (card.payload as unknown as { frontmatter: Record<string, unknown> }).frontmatter;
  assert.equal(fm['type'], 'skill');
  assert.equal(fm['title'], 'How you write tickets');
  assert.equal(fm['summary'], JIRA_TEMPLATE.summary);
  // Nothing declares itself always-on, and this file never runs: no `starts`.
  assert.equal(fm['starts'], undefined);
  // The whole template, with the rule at the end of it, which is inside the
  // Standing instructions section because that section is last.
  assert.equal(card.payload.body, `${JIRA_TEMPLATE.body.trim()}\n\n- ${TICKET_RULE}`);
  assert.match(card.payload.body!, /## When you draft a ticket/);
  assert.equal(card.payload.headline, `Remember this: ${TICKET_RULE}`);
  assert.match(card.rationale, /Goes into How you write tickets\./);
  assert.doesNotMatch(card.rationale, /Your rules/);
  assert.equal(card.asked, true);
  assert.equal(card.inference, false);
});

test('a page rule with no conventions file yet creates the Confluence one', async () => {
  const ctx = rulesCtx({});
  const said = await out(tool(ctx), { rule: PAGE_RULE, target: 'confluence' });

  assert.match(said, /in confluence now/);
  const card = ctx.filed[0]!;
  assert.equal(card.targetPath, CONFLUENCE);
  const fm = (card.payload as unknown as { frontmatter: Record<string, unknown> }).frontmatter;
  assert.equal(fm['title'], 'How you write pages');
  assert.equal(
    card.payload.body,
    `${parseRunnable(CONFLUENCE_CONVENTIONS, 'confluence').body.trim()}\n\n- ${PAGE_RULE}`,
  );
  assert.match(card.rationale, /Goes into How you write pages\./);
});

/**
 * The second rule, and the reason the template ends where it does: the anchor
 * has to be the last heading in the file it just wrote, or every rule after the
 * first would start a second Standing instructions section.
 */
test('a conventions file that exists takes the bullet, with no new heading', async () => {
  const ctx = rulesCtx({
    [JIRA]: {
      title: 'How you write tickets',
      body: `${JIRA_TEMPLATE.body.trim()}\n\n- ${TICKET_RULE}\n`,
    },
  });
  const said = await out(tool(ctx), { rule: PAGE_RULE, target: 'jira' });

  assert.match(said, /in jira now/);
  const card = ctx.filed[0]!;
  assert.equal(card.kind, 'update');
  assert.equal(card.targetPath, JIRA);
  assert.equal(card.payload.append, `\n- ${PAGE_RULE}`);
  assert.doesNotMatch(card.payload.append!, /## Standing instructions/);
  assert.ok(card.baseHash);
  assert.match(card.rationale, /Goes into How you write tickets's standing instructions\./);
});

test('a rule already in the conventions file is refused, not filed twice', async () => {
  const ctx = rulesCtx({
    [JIRA]: { body: `${JIRA_TEMPLATE.body.trim()}\n\n- ${TICKET_RULE}\n` },
  });
  const said = await out(tool(ctx), { rule: TICKET_RULE, target: 'jira' });

  assert.match(said, /already a standing instruction there/);
  assert.equal(ctx.filed.length, 0);
});

/**
 * The model spells the target from the prose it was given, where the system is
 * called Jira. A capital must reach the one file, not write a second one beside
 * it under a name nothing else resolves.
 */
test('the name folds, so "Jira" is the same file as "jira"', async () => {
  const ctx = rulesCtx({
    [JIRA]: { title: 'How you write tickets', body: JIRA_TEMPLATE.body.trim() },
  });
  const said = await out(tool(ctx), { rule: TICKET_RULE, target: 'Jira' });

  assert.equal(ctx.filed[0]!.targetPath, JIRA);
  assert.equal(ctx.filed[0]!.kind, 'update');
  assert.match(said, /in jira now/);

  const empty = rulesCtx({});
  await out(tool(empty), { rule: TICKET_RULE, target: 'Confluence' });
  assert.equal(empty.filed[0]!.targetPath, CONFLUENCE);
});

/** Only these two names create a file. Anything else still falls to the house rules. */
test('a name that is not a conventions skill still falls back to the house rules', async () => {
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } });
  const said = await out(tool(ctx), { rule: TICKET_RULE, target: 'zendesk' });

  assert.equal(ctx.filed[0]!.kind, 'update');
  assert.equal(ctx.filed[0]!.targetPath, RULES);
  assert.match(said, /in house-rules now/);
  assert.match(said, /Nothing is called "zendesk" here/);
});

test('a second card for the same missing conventions file is refused', async () => {
  const ctx = rulesCtx({}, [
    {
      id: 'p_waiting',
      kind: 'note',
      targetPath: JIRA,
      payload: { path: JIRA, frontmatter: { type: 'skill', title: 'How you write tickets' } },
      rationale: 'You asked for this in chat.',
    },
  ]);
  const said = await out(tool(ctx), { rule: TICKET_RULE, target: 'jira' });

  assert.match(said, /^Not proposed:/);
  assert.equal(ctx.filed.length, 0);
});

test('propose_instruction is one of the propose tools, on in every session', () => {
  const names = createProposeTools(rulesCtx({}), 'session-1').map((t) => t.name);
  assert.ok(names.includes('propose_instruction'), names.join(', '));
});

/**
 * A rule was the only move the model had when the PM corrected it, so a wrong
 * fact and a typo both came out as standing rules. The fix is words, not a gate:
 * the description now sends a corrected FACT to `propose_update` and lets a
 * one-off slip go unfiled. Only the cross-tool half is asserted here, because
 * the tool name is an address and the rest is prose that may be reworded.
 */
test('the description sends a corrected fact to propose_update instead', () => {
  const said = tool(rulesCtx({})).description ?? '';
  assert.match(said, /propose_update/);
});

/**
 * The "What you want from Qale" list (docs/learning-how-you-work.md ticket 8).
 * It sits above Your rules, so a line is added or removed with one patch over
 * the whole section, never an append. What the PM said in the chat lands on
 * the spot; a line Qale worked out is a card; taking a line off is always a
 * card. The payload says `learned`, so the Activity row can say what Qale
 * now knows.
 */

interface WantFiled {
  kind: string;
  targetPath: string | null;
  asked?: boolean;
  payload: {
    patch?: { search: string; replace: string }[];
    body?: string;
    headline?: string;
    learned?: { what: string; from: string };
  };
  rationale: string;
}

const WANT_HEADING = '## What you want from Qale';
const WAITING = 'Tell me who is waiting for something before it ships, and what they were told.';
const API_LINE = 'Tell me what changed in the API, written down somewhere.';

/** The section as shipped, from the heading to its last bullet. */
const wantSection = (body: string): string => {
  const start = body.indexOf(WANT_HEADING);
  const end = body.indexOf('## Your rules');
  return body.slice(start, end).replace(/\s+$/, '');
};

test('a line the PM asked for lands on the list on the spot, above Your rules', async () => {
  const files = { [RULES]: { title: 'House rules', body: `${HOUSE}\n` } };
  const ctx = rulesCtx(files);
  const said = await out(tool(ctx), {
    rule: API_LINE,
    list: 'add',
    asked: true,
    target: 'arrival',
  });

  assert.match(said, /^Applied: Learned "Tell me what changed in the API/);
  assert.match(said, /under 'What you want from Qale' now/);
  const card = ctx.filed[0] as unknown as WantFiled;
  assert.equal(card.kind, 'update');
  // `target` says nothing here: the list has one home.
  assert.equal(card.targetPath, RULES);
  assert.equal(card.asked, true);
  // One patch over the whole section, and no append.
  const patch = card.payload.patch!;
  assert.equal(patch.length, 1);
  assert.equal(patch[0]!.search, wantSection(HOUSE));
  assert.equal(patch[0]!.replace, `${wantSection(HOUSE)}\n- ${API_LINE}`);
  assert.equal((card.payload as { append?: string }).append, undefined);
  assert.equal(card.payload.headline, `Remember this: ${API_LINE}`);
  assert.match(card.rationale, /Goes on the list of what you want from Qale/);
  assert.deepEqual(card.payload.learned, { what: API_LINE, from: 'what you said in the chat' });

  // It landed inside the section, and Your rules is still last and untouched.
  const body = files[RULES]!.body;
  const section = wantSection(body);
  assert.ok(section.endsWith(`- ${API_LINE}`), section);
  assert.ok(body.trimEnd().endsWith('delete it to drop it.'), 'Your rules gained nothing');
});

test('a line Qale worked out from repeated questions is a card', async () => {
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } });
  const said = await out(tool(ctx), {
    rule: API_LINE,
    list: 'add',
    why: 'You asked what changed in the API three times this month.',
  });

  assert.match(said, /^Proposed a line for what you want from Qale \(p1\)/);
  assert.match(said, /Awaiting review/);
  const card = ctx.filed[0] as unknown as WantFiled;
  assert.equal(card.asked, false);
  assert.match(card.rationale, /^You asked what changed in the API three times this month\./);
  assert.equal(card.payload.learned?.from, 'what you keep asking for');
});

test('a line already on the list is not added twice', async () => {
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } });
  const said = await out(tool(ctx), { rule: WAITING.toUpperCase(), list: 'add', asked: true });

  assert.match(said, /^Not proposed: that line is already on the list/);
  assert.equal(ctx.filed.length, 0);
});

test('with no house-rules file, the add writes the whole document with the line in its section', async () => {
  const ctx = rulesCtx({});
  await out(tool(ctx), { rule: API_LINE, list: 'add', asked: true });

  const card = ctx.filed[0] as unknown as WantFiled;
  assert.equal(card.kind, 'note');
  assert.equal(card.targetPath, RULES);
  const body = card.payload.body!;
  assert.ok(wantSection(body).endsWith(`- ${API_LINE}`));
  assert.ok(body.trimEnd().endsWith('delete it to drop it.'));
});

test('taking a line off is always a card, anchored on the section', async () => {
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } });
  const said = await out(tool(ctx), { rule: 'who is waiting for something', list: 'remove' });

  assert.match(
    said,
    /^Proposed taking a line off what you want from Qale \(p1\): "Tell me who is waiting/,
  );
  assert.match(said, /removing is always the PM's call/);
  const card = ctx.filed[0] as unknown as WantFiled;
  assert.equal(card.kind, 'update');
  assert.equal(card.asked, false);
  const patch = card.payload.patch!;
  assert.equal(patch[0]!.search, wantSection(HOUSE));
  assert.equal(
    patch[0]!.replace,
    wantSection(HOUSE)
      .split('\n')
      .filter((line) => line !== `- ${WAITING}`)
      .join('\n'),
  );
  assert.equal(card.payload.headline, `Stop this: ${WAITING}`);
  assert.match(card.rationale, /Comes off the list of what you want from Qale\./);
  assert.deepEqual(card.payload.learned, {
    what: `Off the list: ${WAITING}`,
    from: 'what you said in the chat',
  });
});

test('a remove that matches no line, or more than one, is refused with the list', async () => {
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } });
  const none = await out(tool(ctx), { rule: 'Book my flights.', list: 'remove' });
  assert.match(none, /^Rejected: no line says that\./);
  assert.match(none, /The list holds:\n- When a meeting ends/);

  // "Tell me" opens two lines, so neither can be meant on its own.
  const two = await out(tool(ctx), { rule: 'tell me', list: 'remove' });
  assert.match(two, /^Rejected: more than one line says that\./);
  assert.match(two, /Quote the one you mean/);
  assert.equal(ctx.filed.length, 0);

  const missing = await out(tool(rulesCtx({})), { rule: WAITING, list: 'remove' });
  assert.match(missing, /^Rejected: there is no house rules file yet/);
});

test('a remove already waiting on the PM is not proposed twice', async () => {
  const section = wantSection(HOUSE);
  const replace = section
    .split('\n')
    .filter((line) => line !== `- ${WAITING}`)
    .join('\n');
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } }, [
    {
      id: 'p_waiting',
      kind: 'update',
      targetPath: RULES,
      payload: {
        path: RULES,
        patch: [{ search: section, replace }],
        rationale: 'You said so in chat.',
      },
      rationale: 'You said so in chat.',
    },
  ]);
  const said = await out(tool(ctx), { rule: WAITING, list: 'remove' });

  assert.match(said, /already waiting on the PM takes that line off \(p_waiting\)/);
  assert.equal(ctx.filed.length, 0);

  const add = await out(tool(ctx), { rule: API_LINE, list: 'add', asked: true });
  assert.match(add, /^Applied: Learned/);
});

test('an add already waiting on the PM is not proposed twice', async () => {
  const section = wantSection(HOUSE);
  const ctx = rulesCtx({ [RULES]: { body: `${HOUSE}\n` } }, [
    {
      id: 'p_waiting',
      kind: 'update',
      targetPath: RULES,
      payload: {
        path: RULES,
        patch: [{ search: section, replace: `${section}\n- ${API_LINE}` }],
        rationale: 'You keep asking.',
      },
      rationale: 'You keep asking.',
    },
  ]);
  const said = await out(tool(ctx), { rule: API_LINE, list: 'add' });

  assert.match(said, /already waiting on the PM adds that same line \(p_waiting\)/);
  assert.equal(ctx.filed.length, 0);
});

test('a house-rules file without the section says so instead of guessing where to put the line', async () => {
  const ctx = rulesCtx({
    [RULES]: { body: '# House rules\n\n## Your rules\n\n- Keep the link.\n' },
  });
  const said = await out(tool(ctx), { rule: API_LINE, list: 'add', asked: true });

  assert.match(said, /^Rejected: the house rules have no "What you want from Qale" section/);
  assert.equal(ctx.filed.length, 0);
});
