import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReservedFile,
  isFolderIndex,
  renderFolderIndex,
  renderRootIndex,
  OKF_VERSION,
  type IndexFolder,
} from '../src/index.js';

/**
 * OKF §8 index.md rendering + §3.1 reserved-filename handling
 * (OKF alignment, phase 1). Pure builders, so asserted on their exact
 * output — the app compares generated content byte-for-byte to decide whether to
 * rewrite, so format stability is a real contract here.
 */

test('isReservedFile matches index.md/log.md at root and in folders; isFolderIndex only folder hubs', () => {
  assert.equal(isReservedFile('index.md'), true);
  assert.equal(isReservedFile('log.md'), true);
  assert.equal(isReservedFile('insights/index.md'), true);
  assert.equal(isReservedFile('decisions/log.md'), true);
  assert.equal(isReservedFile('insights/acme.md'), false);
  assert.equal(isReservedFile('notes/index-of-things.md'), false);
  // Root index.md is reserved but is NOT a folder hub — the older predicate misses it.
  assert.equal(isFolderIndex('index.md'), false);
  assert.equal(isReservedFile('index.md'), true);
});

test('renderFolderIndex groups by lifecycle, projects summary to description, sorts by title', () => {
  const folder: IndexFolder = {
    dir: 'insights',
    label: 'Insights',
    purpose: 'analyses over the raw layer',
    entries: [
      {
        path: 'insights/zeta.md',
        title: 'Zeta',
        description: 'Zeta wants SSO.',
        lifecycle: 'processed',
      },
      {
        path: 'insights/acme.md',
        title: 'Acme',
        description: 'Acme wants SCIM.',
        lifecycle: 'processed',
      },
      {
        path: 'insights/old.md',
        title: 'Old finding',
        description: 'No longer holds.',
        lifecycle: 'stale',
      },
    ],
  };
  const out = renderFolderIndex(folder);
  assert.match(out, /^---\ndescription: Insights — analyses over the raw layer\n---\n/);
  assert.match(out, /# Insights/);
  // Processed precedes Stale (attention-first order), Acme before Zeta (title sort).
  const processed = out.indexOf('## Processed');
  const stale = out.indexOf('## Stale');
  assert.ok(processed > 0 && stale > processed, 'Processed section comes before Stale');
  assert.ok(out.indexOf('[Acme]') < out.indexOf('[Zeta]'), 'entries sort by title');
  // Description projected from summary, entry links are vault-relative.
  assert.match(out, /\* \[Acme\]\(insights\/acme\.md\) — Acme wants SCIM\./);
});

test('renderFolderIndex with no lifecycle values renders one flat list', () => {
  const folder: IndexFolder = {
    dir: 'people',
    label: 'People',
    purpose: 'people the work touches',
    entries: [
      { path: 'people/asa.md', title: 'Åsa', description: 'VP Eng at Nordkap.' },
      { path: 'people/jonas.md', title: 'Jonas', description: 'PM at Kranelund.' },
    ],
  };
  const out = renderFolderIndex(folder);
  assert.doesNotMatch(out, /## /, 'no subsections when nothing carries a lifecycle');
  assert.match(out, /\* \[Jonas\]\(people\/jonas\.md\) — PM at Kranelund\./);
});

test('renderRootIndex stamps okf_version, links non-empty folders with counts', () => {
  const folders: IndexFolder[] = [
    {
      dir: 'decisions',
      label: 'Decisions',
      purpose: 'the append-only decision spine',
      entries: [
        { path: 'decisions/a.md', title: 'A', description: 'x', lifecycle: 'active' },
        { path: 'decisions/b.md', title: 'B', description: 'y', lifecycle: 'active' },
      ],
    },
    { dir: 'notes', label: 'Notes', purpose: 'authored notes', entries: [] },
  ];
  const out = renderRootIndex(folders, 'vault-dev');
  assert.match(out, new RegExp(`okf_version: "${OKF_VERSION}"`));
  assert.match(out, /# vault-dev/);
  assert.match(
    out,
    /\* \[Decisions\]\(decisions\/index\.md\) — the append-only decision spine \(2\)/,
  );
  assert.doesNotMatch(out, /Notes/, 'empty folders are omitted from the root map');
});

test('renderers collapse newlines in titles/descriptions so a row never breaks', () => {
  const out = renderFolderIndex({
    dir: 'notes',
    label: 'Notes',
    purpose: 'x',
    entries: [{ path: 'notes/a.md', title: 'Multi\nline', description: 'a\n\nb' }],
  });
  assert.match(out, /\* \[Multi line\]\(notes\/a\.md\) — a b/);
});
