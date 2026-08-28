import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as defaults from '../src/defaults.js';

/**
 * Every skill, agent and voice is authored twice: once as a template literal in
 * `defaults.ts`, which seeds a new workspace, and once as a file under
 * `vault-dev/`, which is the demo. About 14,000 tokens of prose, written in two
 * places, with nothing making them agree. A wording change is two edits, and a
 * missed second edit shows up as the demo and a fresh install saying different
 * things, weeks later and with no way to tell which one is right.
 *
 * This file is the check. It reads both copies and compares them.
 *
 * The pairs are DERIVED, not listed. `DEFAULT_SKILLS`, `DEFAULT_AGENTS`,
 * `DEFAULT_VOICES` and `DEFAULT_NOTES` already hold the vault path of every
 * seeded file, because that is how the app seeds them, so the same path under
 * `vault-dev/` is the demo copy. A hand-written list of nine pairs would go
 * stale on the tenth skill, and stale in the one direction nobody looks: the new
 * file would be the unchecked one. Two more tests close the two ways a file can
 * fall outside those registries and still drift.
 */

const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * The two copies are formatted differently on purpose: the `vault-dev` files put
 * a blank line after every heading, the template literals do not. So the
 * comparison is on words, not bytes. Runs of spaces and tabs collapse, each line
 * is trimmed, and blank lines drop out. Anything left is a real difference.
 */
function words(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/**
 * The comparison, and what it prints when it fails. Handing two 5,000-character
 * strings to `assert.deepEqual` prints both of them in full, which is a wall
 * nobody reads, so this fails with the pair and the first few differing lines
 * instead, each labelled with the side it came from.
 */
function sameWords(file: string, constant: string, demo: string[], seeded: string[]): void {
  if (demo.length === seeded.length && demo.every((line, i) => line === seeded[i])) return;
  const lines = [
    '',
    'The two copies of this file have drifted apart:',
    `  demo:     vault-dev/${file}`,
    `  seeded:   ${constant} in packages/sessions/src/defaults.ts`,
    'Edit whichever one is wrong so both say the same thing. Blank lines and runs',
    'of spaces are already ignored, so this is a real wording difference.',
    '',
  ];
  let shown = 0;
  for (let i = 0; i < Math.max(demo.length, seeded.length) && shown < 4; i++) {
    if (demo[i] === seeded[i]) continue;
    lines.push(`  line ${i + 1}`);
    lines.push(`    demo:   ${demo[i] ?? '(the file ends here)'}`);
    lines.push(`    seeded: ${seeded[i] ?? '(the constant ends here)'}`);
    shown++;
  }
  assert.fail(lines.join('\n'));
}

/** Every file the pack seeds, with the name of the constant it comes from. */
function seededFiles(): { file: string; content: string; constant: string }[] {
  const byContent = new Map<string, string>();
  for (const [name, value] of Object.entries(defaults)) {
    if (typeof value === 'string' && !byContent.has(value)) byContent.set(value, name);
  }
  return [
    ...defaults.DEFAULT_SKILLS,
    ...defaults.DEFAULT_AGENTS,
    ...defaults.DEFAULT_VOICES,
    ...defaults.DEFAULT_NOTES,
  ].map(({ file, content }) => ({
    file,
    content,
    constant: byContent.get(content) ?? 'an unnamed literal',
  }));
}

const HOUSE_RULES_FILE = 'skills/house-rules/SKILL.md';

test('every seeded skill, agent and voice says the same thing as its demo copy', () => {
  const pairs = seededFiles().filter(({ file }) => file !== HOUSE_RULES_FILE);
  // A registry that came back empty would pass the loop below in silence.
  assert.ok(pairs.length >= 12, `only ${pairs.length} seeded files were found`);
  for (const { file, content, constant } of pairs) {
    sameWords(
      file,
      constant,
      words(readFileSync(join(REPO, 'vault-dev', file), 'utf8')),
      words(content),
    );
  }
});

/**
 * The one file allowed to differ, and only in one place. The demo vault ships
 * with two standing instructions already approved, because the Skills page has
 * to show what an answered "remember to..." looks like. A fresh workspace has
 * been told nothing yet, so its copy ends at the "Your rules" intro.
 *
 * `propose_instruction` appends bullets to the end of the file, so those two
 * extra bullets are the last lines and nothing else. That makes the rule exact:
 * the seeded copy must be a PREFIX of the demo copy, and everything past the end
 * of it must be a bullet under the final heading. A word changed anywhere else,
 * including inside the "Your rules" intro prose, breaks the prefix and fails.
 */
test('the house rules match down to Your rules, where the demo carries its own extra bullets', () => {
  const demo = words(readFileSync(join(REPO, 'vault-dev', HOUSE_RULES_FILE), 'utf8'));
  const seeded = words(defaults.HOUSE_RULES);
  sameWords(HOUSE_RULES_FILE, 'HOUSE_RULES', demo.slice(0, seeded.length), seeded);

  // Nothing may follow "Your rules" but rules, in either copy.
  assert.ok(seeded.includes('## Your rules'), 'the seeded house rules lost the Your rules heading');
  for (const extra of demo.slice(seeded.length)) {
    assert.match(
      extra,
      /^- /,
      `the demo house rules carry a line the seeded copy does not, and it is not a standing instruction: ${extra}`,
    );
  }
});

/**
 * The gap the derived list cannot see: a file that exists in the demo vault and
 * is in no registry, so nothing above ever opened it. `skills/`, `agents/` and
 * `voices/` are seeded whole, so every file in them is either a pair or a
 * deliberate demo-only file named here. `notes/` is not swept, because the demo
 * vault is mostly notes and only one of them is seeded.
 */
test('a demo skill, agent or voice with no seeded pair is named here or it fails', () => {
  // Deliberately demo-only: it carries a dead setting and a typo, so the Skills
  // page has a broken file to show. Seeding one would be absurd.
  const demoOnly = new Set(['skills/broken-demo/SKILL.md']);
  const paired = new Set(seededFiles().map((s) => s.file));

  for (const folder of ['skills', 'agents', 'voices']) {
    const root = join(REPO, 'vault-dev', folder);
    const found: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        for (const inner of readdirSync(join(root, entry.name))) {
          found.push(`${folder}/${entry.name}/${inner}`);
        }
      } else {
        found.push(`${folder}/${entry.name}`);
      }
    }
    assert.ok(found.length > 0, `vault-dev/${folder} is empty`);
    for (const file of found) {
      assert.ok(
        paired.has(file) || demoOnly.has(file),
        `vault-dev/${file} has no copy in defaults.ts, so nothing checks it for drift.\n` +
          'Either seed it (add it to DEFAULT_SKILLS, DEFAULT_AGENTS or DEFAULT_VOICES with its\n' +
          'own constant) or add it to demoOnly in this test and say why it is demo-only.',
      );
    }
  }
});

/**
 * The other gap: a constant written in `defaults.ts` that no registry seeds.
 * `ask` is the one real case, and it is built-in only, so the sweep above never
 * sees it. It is named here rather than filtered by a pattern, so the next
 * constant that quietly stops being seeded is loud.
 *
 * This reads the module namespace of `defaults.ts` rather than the package's
 * public exports on purpose: a constant added to the file but not re-exported
 * through `index.ts` is exactly the one that would slip past.
 */
test('every skill-shaped constant in defaults.ts is seeded, or is named as a built-in', () => {
  const seeded = new Set(seededFiles().map((s) => s.content));
  const unseeded = Object.entries(defaults)
    .filter(([, value]) => typeof value === 'string' && value.startsWith('---\ntype:'))
    .filter(([, value]) => !seeded.has(value as string))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(
    unseeded,
    ['ASK_SKILL'],
    'a skill-shaped constant in defaults.ts is neither seeded nor a known built-in.\n' +
      'Seed it and give it a vault-dev copy, or name it here if it ships as a built-in only.',
  );
});
