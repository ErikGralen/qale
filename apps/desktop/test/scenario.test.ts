import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadScenarios,
  summaryOf,
  turnText,
  validateScenario,
  type Scenario,
} from '../src/main/demo/scenario.js';

/**
 * The scenario loader (docs/plan-demo-replay.md, section 4.1). What matters is
 * that a script with a wrong shape is refused with a line that names the
 * field, and that one bad file never takes the folder down with it.
 */

const FIXTURE = join(import.meta.dirname, 'fixtures', 'scenario-s1.json');

function fixture(): Scenario {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')) as Scenario;
}

test('the fixture validates and reads back as typed', () => {
  const scenario = fixture();
  assert.deepEqual(validateScenario(scenario).errors, []);
  assert.deepEqual(summaryOf(scenario), {
    id: 's1',
    title: 'The meeting produced actions',
    do: 'Drag brasserie-lund-review.vtt onto the window.',
  });
  const drop = scenario.conversations[0]!;
  assert.deepEqual(drop.trigger, { kind: 'skill', skill: 'arrival' });
  assert.equal(drop.turns[0]?.tools?.[0]?.name, 'file_source');
  // An array of lines is one text with newlines between the lines.
  assert.equal(
    turnText(drop.turns[2]!),
    'No-show fees has a date now: the end of October.\n\nRebecca writes the BOK-300 stories by {{today+10}}.',
  );
  assert.equal(turnText(drop.turns[0]!), '');
});

test('a wrong shape is refused with the field named', () => {
  const errorsOf = (patch: (s: Record<string, unknown>) => void): string[] => {
    const s = fixture() as unknown as Record<string, unknown>;
    patch(s);
    return validateScenario(s).errors;
  };
  assert.match(errorsOf((s) => (s['version'] = 2)).join('\n'), /version must be 1/);
  assert.match(errorsOf((s) => delete s['do']).join('\n'), /do must be a non-empty string/);
  assert.match(
    errorsOf((s) => ((s['conversations'] as Record<string, unknown>[])[0]!['trigger'] = { kind: 'button' }))
      .join('\n'),
    /conversations\[0\]\.trigger\.kind/,
  );
  assert.match(
    errorsOf(
      (s) => ((s['conversations'] as Record<string, unknown>[])[0]!['trigger'] = { kind: 'skill' }),
    ).join('\n'),
    /trigger\.skill must name the skill/,
  );
  assert.match(
    errorsOf((s) => ((s['conversations'] as Record<string, unknown>[])[1]!['turns'] = [{}])).join(
      '\n',
    ),
    /conversations\[1\]\.turns\[0\] has neither text nor tools/,
  );
  assert.match(
    errorsOf((s) => ((s['conversations'] as Record<string, unknown>[])[1]!['id'] = 'drop')).join(
      '\n',
    ),
    /"drop" is used twice/,
  );
  assert.match(
    errorsOf((s) => ((s['lookups'] as Record<string, unknown>)['claims'] = { a: 1 })).join('\n'),
    /lookups\.claims/,
  );
  assert.deepEqual(validateScenario('not an object').errors, ['the file is not a JSON object']);
});

test('a typed trigger may name the skill in force and the words it needs', () => {
  const withTrigger = (trigger: unknown): string[] => {
    const s = fixture() as unknown as Record<string, unknown>;
    (s['conversations'] as Record<string, unknown>[])[1]!['trigger'] = trigger;
    return validateScenario(s).errors;
  };
  assert.deepEqual(withTrigger({ kind: 'typed', skill: 'ask', any: ['BOK-412', 'who'] }), []);
  assert.deepEqual(withTrigger({ kind: 'typed', skill: 'commitment-check' }), []);
  assert.match(withTrigger({ kind: 'typed', skill: '' }).join('\n'), /trigger\.skill must be a non-empty string/);
  assert.match(withTrigger({ kind: 'typed', any: [] }).join('\n'), /trigger\.any must be a non-empty array/);
  assert.match(withTrigger({ kind: 'typed', any: ['ok', 3] }).join('\n'), /trigger\.any must be a non-empty array/);
  assert.match(
    withTrigger({ kind: 'skill', skill: 'arrival', any: ['drop'] }).join('\n'),
    /trigger\.any is only for a typed trigger/,
  );
});

test('the folder is read in id order, `_` files are skipped, and a bad file is named and dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qale-scenarios-'));
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  try {
    const s1 = fixture();
    writeFileSync(join(dir, 'zz-first-by-name.json'), JSON.stringify({ ...s1, id: 's0' }));
    writeFileSync(join(dir, 's1.json'), JSON.stringify(s1));
    writeFileSync(join(dir, '_fallback.json'), JSON.stringify({ not: 'a scenario' }));
    writeFileSync(join(dir, 'broken.json'), '{ this is not json');
    writeFileSync(join(dir, 'bad-shape.json'), JSON.stringify({ ...s1, id: 's2', do: '' }));
    writeFileSync(join(dir, 'notes.txt'), 'ignored');
    const loaded = loadScenarios(dir);
    assert.deepEqual(
      loaded.map((s) => s.id),
      ['s0', 's1'],
    );
    assert.equal(errors.length, 2);
    assert.match(errors[0]!, /bad-shape\.json/);
    assert.match(errors[0]!, /do must be a non-empty string/);
    assert.match(errors[1]!, /broken\.json/);
  } finally {
    console.error = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing or empty folder is an empty list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qale-scenarios-'));
  try {
    assert.deepEqual(loadScenarios(join(dir, 'nowhere')), []);
    mkdirSync(join(dir, 'empty'));
    assert.deepEqual(loadScenarios(join(dir, 'empty')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
