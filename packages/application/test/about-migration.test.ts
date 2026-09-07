import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromPath, type CreateActivityInput } from '@qale/domain';
import { parseNote as parseRaw } from '@qale/markdown';
import {
  aboutMigrationLine,
  ABOUT_MIGRATION_COMMIT,
  migrateProductPagesToAbout,
} from '../src/index.js';
import type { IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * The one-time move of the three company pages from `research/` into `about/`
 * (docs/learning-how-you-work.md, ticket 16). A workspace made before the about
 * shelf holds them under research; the first open after the change moves them,
 * once, and says so in one commit and one Activity row.
 */

/** A file as its frontmatter and body, the body without the blank line the block leaves. */
function parseNote(raw: string) {
  const parsed = parseRaw(raw);
  return { ...parsed, body: parsed.body.replace(/^\n+/, '') };
}

/** The smallest workspace that can be moved around: a path → content map. */
function world(files: Record<string, string>) {
  const disk = new Map(Object.entries(files));
  const indexed = new Set(disk.keys());
  const commits: { paths: string[]; message: string }[] = [];
  const rows: CreateActivityInput[] = [];
  const vault = {
    list: async () => [...disk.keys()].map((path) => ({ path, mtime: 1 })),
    readRaw: async (p: string) => disk.get(p) ?? null,
    writeRaw: async (p: string, c: string) => void disk.set(p, c),
    remove: async (p: string) => void disk.delete(p),
    exists: async (p: string) => disk.has(p),
    readNote: async (p: string) =>
      disk.has(p) ? ({ path: p, slug: slugFromPath(p) } as never) : null,
  } as unknown as VaultPort;
  const index = {
    reindex: (n: { path: string }) => void indexed.add(n.path),
    removeByPath: (p: string) => void indexed.delete(p),
  } as unknown as IndexPort;
  const git = {
    commitPaths: async (paths: string[], message: string) => void commits.push({ paths, message }),
    history: async () => [],
  };
  const activity = {
    record: (input: CreateActivityInput) => {
      rows.push(input);
      return { ...input, id: 'a1', at: 1, reverted: null };
    },
  };
  const ctx = { vault, index, git, activity } as unknown as UseCaseContext;
  return { disk, indexed, commits, rows, ctx };
}

const PRODUCT = `---
type: research
title: Product
summary: What the product is and who it is for.
tags: ['scheduling']
sources: ['[[sources/2026-05-18-nordkap-qbr]]']
---

# Product

A scheduling tool for field teams. Relates to [[research/technical]].
`;

const TECHNICAL = `---
type: 'research'
title: Technical
summary: The shape of the system.
sources: []
---

# Technical

One Rails app and one worker. See [[research/product.md]].
`;

const COMPETITORS = `---
type: research
title: Competitors
summary: Who else sells this.
sources: []
---

# Competitors

Two of them. The product is described in [[research/product|the product page]].
`;

const INSIGHT = `---
type: insight
summary: Enterprise buyers gate on SSO.
evidence: ['[[sources/2026-05-18-nordkap-qbr]]']
confidence: high
---

# Enterprise buyers gate on SSO

Constrained by [[blocks::research/organization#Teams|who owns auth]].
`;

const UNRELATED = `---
type: note
summary: A scratch note.
---

Nothing here links to a product page.
`;

function workspace() {
  return world({
    'research/index.md': '# Research\n\n* [Product](research/product.md)\n',
    'research/product.md': PRODUCT,
    'research/technical.md': TECHNICAL,
    'research/organization.md':
      '---\ntype: research\ntitle: Organization\nsources: []\n---\n\n# Organization\n\nThree teams.\n',
    'research/competitors.md': COMPETITORS,
    'insights/enterprise-buyers-gate-on-sso.md': INSIGHT,
    'notes/scratch.md': UNRELATED,
  });
}

test('the three company pages move into about/, and the rest of research stays', async () => {
  const w = workspace();
  const result = await migrateProductPagesToAbout(w.ctx);

  assert.deepEqual(result.moved, [
    'research/product.md',
    'research/technical.md',
    'research/organization.md',
  ]);
  assert.deepEqual(result.left, []);
  assert.deepEqual([...w.disk.keys()].sort(), [
    'about/organization.md',
    'about/product.md',
    'about/technical.md',
    'insights/enterprise-buyers-gate-on-sso.md',
    'notes/scratch.md',
    'research/competitors.md',
    'research/index.md',
  ]);
  // The index follows the files rather than waiting for a rescan.
  assert.equal(w.indexed.has('research/product.md'), false);
  assert.ok(w.indexed.has('about/product.md'));
});

test('a moved page keeps everything but its type', async () => {
  const w = workspace();
  await migrateProductPagesToAbout(w.ctx);

  const page = parseNote(w.disk.get('about/product.md')!);
  assert.equal(page.frontmatter['type'], 'about');
  assert.equal(page.frontmatter['title'], 'Product');
  assert.equal(page.frontmatter['summary'], 'What the product is and who it is for.');
  assert.deepEqual(page.frontmatter['tags'], ['scheduling']);
  assert.deepEqual(page.frontmatter['sources'], ['[[sources/2026-05-18-nordkap-qbr]]']);
  assert.equal(
    page.body,
    '# Product\n\nA scheduling tool for field teams. Relates to [[about/technical]].\n',
  );
});

test('links follow the move: typed links, aliases and a link that carries the .md', async () => {
  const w = workspace();
  const result = await migrateProductPagesToAbout(w.ctx);

  assert.deepEqual(result.rewritten.sort(), [
    'insights/enterprise-buyers-gate-on-sso.md',
    'research/competitors.md',
  ]);
  const technical = w.disk.get('about/technical.md')!;
  assert.ok(technical.includes('See [[about/product.md]].'), technical);
  const competitors = w.disk.get('research/competitors.md')!;
  assert.ok(competitors.includes('[[about/product|the product page]]'), competitors);
  const insight = w.disk.get('insights/enterprise-buyers-gate-on-sso.md')!;
  assert.ok(insight.includes('[[blocks::about/organization#Teams|who owns auth]]'), insight);
  // A file with nothing to rewrite is not written.
  assert.equal(w.disk.get('notes/scratch.md'), UNRELATED);
  // The folder map is left for the orientation pass, which regenerates it.
  assert.equal(w.disk.get('research/index.md'), '# Research\n\n* [Product](research/product.md)\n');
});

test('a page already in about/ wins, and the one in research/ is left alone', async () => {
  const w = workspace();
  w.disk.set(
    'about/product.md',
    '---\ntype: about\ntitle: Product\nsources: []\n---\n\n# Product\n\nTheirs.\n',
  );
  const result = await migrateProductPagesToAbout(w.ctx);

  assert.deepEqual(result.left, ['research/product.md']);
  assert.deepEqual(result.moved, ['research/technical.md', 'research/organization.md']);
  assert.ok(w.disk.get('about/product.md')!.includes('Theirs.'));
  assert.ok(w.disk.has('research/product.md'));
});

test('one commit for the whole move, and one Activity row without a put-back', async () => {
  const w = workspace();
  const result = await migrateProductPagesToAbout(w.ctx);

  assert.equal(w.commits.length, 1);
  assert.equal(w.commits[0]!.message, ABOUT_MIGRATION_COMMIT);
  assert.equal(ABOUT_MIGRATION_COMMIT, 'workspace: move the product pages into about');
  assert.deepEqual([...w.commits[0]!.paths].sort(), [...result.changed].sort());
  for (const path of [
    'research/product.md',
    'about/product.md',
    'research/organization.md',
    'about/organization.md',
    'insights/enterprise-buyers-gate-on-sso.md',
  ]) {
    assert.ok(w.commits[0]!.paths.includes(path), path);
  }

  assert.equal(w.rows.length, 1);
  const row = w.rows[0]!;
  assert.equal(row.line, 'I moved product, technical and organization from Research to About.');
  assert.equal(row.action, 'updated');
  assert.equal(row.path, null);
  assert.equal(row.sessionId, null);
  assert.equal(row.revert.commit, null);
  assert.ok(row.reason.endsWith('.') && !row.reason.includes('—'));
});

test('the Activity line names what moved, and nothing else', () => {
  assert.equal(
    aboutMigrationLine(['product', 'technical', 'organization']),
    'I moved product, technical and organization from Research to About.',
  );
  assert.equal(aboutMigrationLine(['product']), 'I moved product from Research to About.');
  assert.equal(
    aboutMigrationLine(['product', 'technical']),
    'I moved product and technical from Research to About.',
  );
});

test('a workspace with none of the three is left completely alone', async () => {
  const w = world({
    'research/competitors.md': COMPETITORS,
    'notes/scratch.md': UNRELATED,
  });
  const result = await migrateProductPagesToAbout(w.ctx);

  assert.deepEqual(result.changed, []);
  assert.equal(w.commits.length, 0);
  assert.equal(w.rows.length, 0);
  assert.equal(w.disk.get('research/competitors.md'), COMPETITORS);
});

test('running it twice is running it once', async () => {
  const w = workspace();
  await migrateProductPagesToAbout(w.ctx);
  const after = new Map(w.disk);

  const second = await migrateProductPagesToAbout(w.ctx);
  assert.deepEqual(second.changed, []);
  assert.equal(w.commits.length, 1);
  assert.equal(w.rows.length, 1);
  assert.deepEqual([...w.disk.entries()], [...after.entries()]);
});
