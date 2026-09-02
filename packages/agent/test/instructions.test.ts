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
  return {
    vault: {
      readNote: async (p: string) => {
        const note = files[p];
        return note
          ? {
              path: p,
              type: 'skill',
              frontmatter: { type: 'skill', ...(note.title ? { title: note.title } : {}) },
              body: note.body,
            }
          : null;
      },
    },
    index: { resolve: () => null, get: () => null },
    proposals: {
      create: (input: Filed) => {
        filed.push(input);
        return { id: `p${filed.length}` };
      },
      list: (status?: string) => (status === 'pending' ? pending : []),
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

  assert.match(said, /^Proposed instruction \(p1\)/);
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

  assert.match(said, /-> house-rules\./);
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
  assert.match(said, /-> house-rules\./);
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
  assert.match(said, /-> librarian\./);
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

  assert.match(said, /^Proposed instruction/);
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

test('the receipt names the card, the rule and where it goes', async () => {
  const ctx = rulesCtx({ [ARRIVAL]: { title: 'Arrival', body: '# Arrival\n' } });
  const said = await out(tool(ctx), {
    rule: RULE,
    target: 'arrival',
    why: 'Erik asked for it after the Nordkap call.',
  });

  assert.equal(said, `Proposed instruction (p1): "${RULE}" -> arrival. Awaiting review.`);
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

  assert.equal(said, `Proposed instruction (p1): "${TICKET_RULE}" -> jira. Awaiting review.`);
  // Nothing is missing: "jira" resolved, to a file the card writes.
  assert.doesNotMatch(said, /Nothing is called/);
  const card = ctx.filed[0]!;
  assert.equal(card.kind, 'note');
  assert.equal(card.targetPath, JIRA);
  assert.equal(card.baseHash, null);
  const fm = (card.payload as unknown as { frontmatter: Record<string, unknown> }).frontmatter;
  assert.equal(fm['type'], 'skill');
  assert.equal(fm['title'], 'How we use Jira');
  assert.equal(fm['summary'], JIRA_TEMPLATE.summary);
  // Nothing declares itself always-on, and this file never runs: no `starts`.
  assert.equal(fm['starts'], undefined);
  // The whole template, with the rule at the end of it, which is inside the
  // Standing instructions section because that section is last.
  assert.equal(card.payload.body, `${JIRA_TEMPLATE.body.trim()}\n\n- ${TICKET_RULE}`);
  assert.match(card.payload.body!, /## When you draft a ticket/);
  assert.equal(card.payload.headline, `Remember this: ${TICKET_RULE}`);
  assert.match(card.rationale, /Goes into How we use Jira\./);
  assert.doesNotMatch(card.rationale, /Your rules/);
  assert.equal(card.asked, true);
  assert.equal(card.inference, false);
});

test('a page rule with no conventions file yet creates the Confluence one', async () => {
  const ctx = rulesCtx({});
  const said = await out(tool(ctx), { rule: PAGE_RULE, target: 'confluence' });

  assert.match(said, /-> confluence\./);
  const card = ctx.filed[0]!;
  assert.equal(card.targetPath, CONFLUENCE);
  const fm = (card.payload as unknown as { frontmatter: Record<string, unknown> }).frontmatter;
  assert.equal(fm['title'], 'How we use Confluence');
  assert.equal(
    card.payload.body,
    `${parseRunnable(CONFLUENCE_CONVENTIONS, 'confluence').body.trim()}\n\n- ${PAGE_RULE}`,
  );
  assert.match(card.rationale, /Goes into How we use Confluence\./);
});

/**
 * The second rule, and the reason the template ends where it does: the anchor
 * has to be the last heading in the file it just wrote, or every rule after the
 * first would start a second Standing instructions section.
 */
test('a conventions file that exists takes the bullet, with no new heading', async () => {
  const ctx = rulesCtx({
    [JIRA]: {
      title: 'How we use Jira',
      body: `${JIRA_TEMPLATE.body.trim()}\n\n- ${TICKET_RULE}\n`,
    },
  });
  const said = await out(tool(ctx), { rule: PAGE_RULE, target: 'jira' });

  assert.match(said, /-> jira\./);
  const card = ctx.filed[0]!;
  assert.equal(card.kind, 'update');
  assert.equal(card.targetPath, JIRA);
  assert.equal(card.payload.append, `\n- ${PAGE_RULE}`);
  assert.doesNotMatch(card.payload.append!, /## Standing instructions/);
  assert.ok(card.baseHash);
  assert.match(card.rationale, /Goes into How we use Jira's standing instructions\./);
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
  const ctx = rulesCtx({ [JIRA]: { title: 'How we use Jira', body: JIRA_TEMPLATE.body.trim() } });
  const said = await out(tool(ctx), { rule: TICKET_RULE, target: 'Jira' });

  assert.equal(ctx.filed[0]!.targetPath, JIRA);
  assert.equal(ctx.filed[0]!.kind, 'update');
  assert.match(said, /-> jira\./);

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
  assert.match(said, /-> house-rules\./);
  assert.match(said, /Nothing is called "zendesk" here/);
});

test('a second card for the same missing conventions file is refused', async () => {
  const ctx = rulesCtx({}, [
    {
      id: 'p_waiting',
      kind: 'note',
      targetPath: JIRA,
      payload: { path: JIRA, frontmatter: { type: 'skill', title: 'How we use Jira' } },
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
