import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANCHOR } from '@qale/domain/demo';
import {
  expandDeep,
  expandTable,
  expandText,
  renderTurn,
  resolveTemplate,
} from '../src/main/demo/script-templates.js';
import { shiftDay } from '../src/main/demo/replay-dates.js';

/**
 * A script is anchor-dated and served on any day (docs/plan-demo-replay.md,
 * section 4.1). The three offsets are the ones the date-shift fix was measured
 * at: the anchor itself, a fortnight, and two months across a month boundary.
 */

const OFFSETS = [0, 12, 65];

test('the templates resolve against the anchor and the offset', () => {
  for (const offset of OFFSETS) {
    const today = shiftDay(ANCHOR, offset);
    assert.equal(resolveTemplate('today', offset), today);
    assert.equal(resolveTemplate('today+7', offset), shiftDay(today, 7));
    assert.equal(resolveTemplate('today-1', offset), shiftDay(today, -1));
    assert.equal(resolveTemplate('date:2026-07-16', offset), shiftDay('2026-07-16', offset));
    assert.equal(expandText('{{ today + 10 }}', offset), shiftDay(today, 10));
  }
  assert.equal(resolveTemplate('today', 0), ANCHOR);
  assert.equal(expandText('{{today}}', 12), '2026-07-29');
  assert.equal(expandText('{{today}}', 65), '2026-09-20');
});

test('a template in prose resolves once, and the plain dates around it slide', () => {
  for (const offset of OFFSETS) {
    const today = shiftDay(ANCHOR, offset);
    const out = expandText('Decided on {{today-1}}, the workshop is on 2026-07-25.', offset);
    assert.equal(out, `Decided on ${shiftDay(today, -1)}, the workshop is on ${shiftDay('2026-07-25', offset)}.`);
  }
});

test('a template inside a path or a wikilink resolves, and a plain date there stays', () => {
  for (const offset of OFFSETS) {
    const today = shiftDay(ANCHOR, offset);
    const cases: [string, string][] = [
      ['[[sources/{{today}}-steering-transcript]]', `[[sources/${today}-steering-transcript]]`],
      [
        'read meetings/{{date:2026-07-16}}-steering.md',
        `read meetings/${shiftDay('2026-07-16', offset)}-steering.md`,
      ],
      ['[[decisions/2026-05-18-h2-order]]', '[[decisions/2026-05-18-h2-order]]'],
      ['see decisions/2026-05-18-h2-order.md', 'see decisions/2026-05-18-h2-order.md'],
      [
        'Filed [[sources/{{today}}-steering]] next to [[decisions/2026-05-18-h2-order]] on 2026-07-17',
        `Filed [[sources/${today}-steering]] next to [[decisions/2026-05-18-h2-order]] on ${today}`,
      ],
    ];
    for (const [before, after] of cases) assert.equal(expandText(before, offset), after, before);
  }
});

test('a tool input is walked whole, and a turn renders text and tools together', () => {
  const offset = 12;
  const today = shiftDay(ANCHOR, offset);
  assert.deepEqual(
    expandDeep(
      {
        path: 'sources/{{today}}-steering-transcript.md',
        due: '2026-07-25',
        sources: ['[[meetings/{{date:2026-07-16}}-steering]]'],
        count: 3,
      },
      offset,
    ),
    {
      path: `sources/${today}-steering-transcript.md`,
      due: shiftDay('2026-07-25', offset),
      sources: [`[[meetings/${shiftDay('2026-07-16', offset)}-steering]]`],
      count: 3,
    },
  );
  const rendered = renderTurn(
    {
      pause: 700,
      text: ['Filed it.', '', 'Rebecca re-scopes by {{today+10}}.'],
      tools: [{ name: 'propose_todo', input: { due: '{{today+10}}' } }],
    },
    offset,
  );
  assert.deepEqual(rendered, {
    pause: 700,
    text: `Filed it.\n\nRebecca re-scopes by ${shiftDay(today, 10)}.`,
    tools: [{ name: 'propose_todo', input: { due: shiftDay(today, 10) } }],
  });
  assert.deepEqual(renderTurn({ tools: [{ name: 'get_voice', input: { voice: 'cs' } }] }, 0), {
    text: '',
    tools: [{ name: 'get_voice', input: { voice: 'cs' } }],
  });
});

test('a lookup table resolves its keys as well as its values', () => {
  const table = expandTable(
    { 'sources/{{today}}-steering.md': 'Steering call on {{today-1}}.' },
    65,
  );
  assert.deepEqual(table, { 'sources/2026-09-20-steering.md': 'Steering call on 2026-09-19.' });
  assert.deepEqual(expandTable(undefined, 65), {});
});
