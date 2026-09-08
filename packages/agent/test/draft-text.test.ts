import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UseCaseContext } from '@qale/application';
import { createTextTools, createVoiceGate } from '../src/tools.js';
import { listVoices } from '../src/voices.js';

/**
 * `draft_text`: takes on a piece of text, shown in the chat.
 *
 * The whole point of the tool is what it does NOT do. It writes no card, files
 * nothing and sends nothing, so the only things worth asserting are the sentence
 * the model gets back, the two ways a call can be empty, and the one rule it
 * kept from the message draft: a voice has to be read before it is written in.
 */

const EXEC = `---
type: skill
title: Exec voice
summary: Short, decided, quantified.
---

Three sentences. Say it flat.
`;

interface Row {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

function world(): UseCaseContext & { rows: Row[] } {
  const rows: Row[] = [];
  const files: Record<string, string> = { 'voices/exec.md': EXEC };
  const notes = Object.keys(files).map((path) => ({
    path,
    slug: path.replace(/\.md$/, ''),
    type: 'skill',
  }));
  const ctx = {
    rows,
    clock: { now: () => '2026-08-23T09:00:00.000Z' },
    vault: { readRaw: async (p: string) => files[p] ?? null },
    index: {
      all: () => notes,
      resolve: (slug: string) => notes.find((n) => n.slug === slug)?.path ?? null,
      get: () => null,
      listByType: () => [],
    },
    proposals: {
      create: (input: Record<string, unknown>) => {
        const row: Row = {
          id: `p${rows.length + 1}`,
          kind: input['kind'] as string,
          payload: input['payload'] as Record<string, unknown>,
        };
        rows.push(row);
        return row;
      },
      list: () => rows,
      get: (id: string) => rows.find((r) => r.id === id) ?? null,
      setStatus: () => {},
      updatePayload: () => {},
      pendingCount: () => rows.length,
    },
  };
  return ctx as unknown as UseCaseContext & { rows: Row[] };
}

const run = async (tool: unknown, params: unknown): Promise<string> => {
  const t = tool as {
    execute: (id: string, p: unknown, s?: AbortSignal) => Promise<{ content: { text: string }[] }>;
  };
  return (await t.execute('call-1', params, undefined)).content[0]!.text;
};

async function tools(ctx: UseCaseContext) {
  const made = createTextTools(createVoiceGate(ctx, await listVoices(ctx)));
  return {
    draft: made.find((t) => t.name === 'draft_text')!,
    voice: made.find((t) => t.name === 'get_voice')!,
  };
}

test('two variants are shown in the chat, and nothing is filed', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, {
    title: 'Exec update',
    variants: [
      { label: 'Short', body: 'Exports land on 3 September.' },
      { label: 'Friendly', body: 'Good news: exports land on 3 September.' },
    ],
  });

  assert.match(said, /Showed 2 versions in the chat: Short, Friendly/);
  assert.match(said, /Nothing was filed and nothing was sent/);
  assert.equal(ctx.rows.length, 0, 'a panel in the chat is not a proposal');
});

test('one variant is a version, not versions', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, { variants: [{ label: 'Short', body: '3 September.' }] });

  assert.match(said, /Showed 1 version in the chat: Short/);
  assert.equal(ctx.rows.length, 0);
});

test('an empty list of variants is refused', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, { variants: [] });

  assert.match(said, /^Rejected: give at least one variant/);
  assert.equal(ctx.rows.length, 0);
});

test('variants with nothing but blank bodies are refused', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, {
    variants: [
      { label: 'Short', body: '  ' },
      { label: 'Friendly', body: '\n' },
    ],
  });

  assert.match(said, /^Rejected: give at least one variant/);
  assert.equal(ctx.rows.length, 0);
});

test('a voice that does not exist is refused, with the roster', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, {
    voice: 'board',
    variants: [{ label: 'Short', body: 'Anything.' }],
  });

  assert.match(said, /no voice called "board"/);
  assert.match(said, /"exec"/);
});

test('an unread voice is refused once, with the brief, then goes through', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const refused = await run(draft, {
    voice: 'exec',
    variants: [{ label: 'Short', body: 'Exports land on 3 September.' }],
  });

  assert.match(refused, /Rejected/);
  assert.match(refused, /Say it flat/, 'the refusal carries the brief, so one retry is enough');

  const said = await run(draft, {
    voice: 'exec',
    variants: [{ label: 'Short', body: 'Exports land on 3 September.' }],
  });
  assert.match(said, /Showed 1 version in the chat: Short/);
  assert.equal(ctx.rows.length, 0);
});

test('a draft in no voice is never refused, whatever the session has read', async () => {
  const ctx = world();
  const { draft, voice } = await tools(ctx);
  await run(voice, { name: 'exec' });

  // Which voice fits, or whether one fits, is a judgement about the reader. The
  // roster informs it in the tool description; nothing here overrules it.
  const said = await run(draft, { variants: [{ label: 'Short', body: '3 September.' }] });
  assert.match(said, /Showed 1 version in the chat: Short/);
});

test('get_voice hands over the brief and counts as having read it', async () => {
  const ctx = world();
  const { draft, voice } = await tools(ctx);
  const brief = await run(voice, { name: 'exec' });
  assert.match(brief, /Voice in force: exec/);

  const said = await run(draft, {
    voice: 'exec',
    variants: [{ label: 'Short', body: 'Exports land on 3 September.' }],
  });
  assert.match(said, /Showed 1 version/);
});

/**
 * The optional `ask` (docs/learning-how-you-work.md, ticket 10): one sentence,
 * up to three options, shown by the panel once a tab is copied. The tool only
 * checks its shape; a fourth option would turn three buttons into a form.
 */

test('an `ask` is accepted and named in the result, and still files nothing', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, {
    variants: [
      { label: 'Three lines', body: 'Decided: x. Shipped: y. Watch: z.' },
      { label: 'One paragraph', body: 'We shipped y.' },
    ],
    ask: {
      text: 'Write updates this way from now on?',
      options: ['For exec', 'For every audience', 'Not now'],
    },
  });

  assert.match(said, /Showed 2 versions in the chat: Three lines, One paragraph/);
  assert.match(said, /asks "Write updates this way from now on\?"/);
  assert.equal(ctx.rows.length, 0);
});

test('an `ask` with more than three options is refused', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, {
    variants: [{ label: 'Short', body: 'Exports land on 3 September.' }],
    ask: { text: 'Which?', options: ['a', 'b', 'c', 'd'] },
  });

  assert.match(said, /^Rejected: `ask` needs one sentence of text and one to three short options/);
});

test('an `ask` with no text or no options is refused', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  for (const ask of [
    { text: '', options: ['a'] },
    { text: 'Which?', options: [] },
    { text: 'Which?', options: ['  '] },
  ]) {
    const said = await run(draft, {
      variants: [{ label: 'Short', body: 'Exports land on 3 September.' }],
      ask,
    });
    assert.match(said, /^Rejected: `ask`/, JSON.stringify(ask));
  }
});

test('a call without `ask` reads as it always did', async () => {
  const ctx = world();
  const { draft } = await tools(ctx);
  const said = await run(draft, {
    variants: [{ label: 'Short', body: 'Exports land on 3 September.' }],
  });

  assert.equal(
    said,
    'Showed 1 version in the chat: Short. Nothing was filed and nothing was sent. If they pick one they will say so.',
  );
});
