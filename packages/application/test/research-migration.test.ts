import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugFromPath, type CreateActivityInput } from '@qale/domain';
import { parseNote as parseRaw } from '@qale/markdown';
import {
  migrateThemesToResearch,
  researchMigrationLine,
  RESEARCH_MIGRATION_COMMIT,
} from '../src/index.js';
import type { IndexPort, UseCaseContext, VaultPort } from '../src/ports.js';

/**
 * The one-time move from `themes/` and `understanding/` into `research/`
 * (docs/memory-types.md MT-8). A workspace made before the research type holds
 * the old folders; the first open after the change moves them, once, and says
 * so in one commit and one Activity row.
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
  const removedDirs: string[] = [];
  const rows: CreateActivityInput[] = [];
  const vault = {
    list: async () => [...disk.keys()].map((path) => ({ path, mtime: 1 })),
    readRaw: async (p: string) => disk.get(p) ?? null,
    writeRaw: async (p: string, c: string) => void disk.set(p, c),
    remove: async (p: string) => void disk.delete(p),
    removeDir: async (d: string) => void removedDirs.push(d),
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
  return { disk, indexed, commits, removedDirs, rows, ctx };
}

const THEME_ONBOARDING = `---
type: 'theme'
summary: 'Enterprise onboarding gates every deal over 200 seats'
tags: ['enterprise-auth']
stance: 'committed'
evidence:
  ['[[insights/enterprise-buyers-gate-on-sso]]', '[[meetings/2026-05-18-nordkap-qbr]]']
sources: ['[[sources/2026-05-18-nordkap-qbr]]']
---

# Enterprise onboarding

Enterprise buyers cannot get us through their own IT process. See [[themes/on-prem-deployment]].
`;

const THEME_ON_PREM = `---
type: theme
summary: On-prem deployment, asked for twice and declined both times
stance: wont-do
evidence: '[[insights/on-prem-asked-twice]]'
---

# On-prem deployment

Asked for twice. Declined both times, see [[decisions/2026-06-18-no-on-prem]].
`;

const UNDERSTANDING_PRODUCT = `---
type: note
title: Product
summary: What the product is and who it is for.
sources: []
---

# Product

A scheduling tool for field teams. Relates to [[understanding/technical]].
`;

const WHAT_GOES_HERE = `---
type: note
title: Product understanding
summary: The three notes that hold what we know about the product.
sources: []
---

# Product understanding

Three notes, and no more.
`;

const INSIGHT = `---
type: insight
summary: Enterprise buyers gate on SSO.
evidence: ['[[sources/2026-05-18-nordkap-qbr]]']
theme: '[[themes/enterprise-onboarding]]'
confidence: high
---

# Enterprise buyers gate on SSO

Part of [[themes/enterprise-onboarding|the onboarding case]].
`;

const DECISION = `---
type: decision
summary: No on-prem deployment.
standing: active
theme: '[[themes/on-prem-deployment]]'
sources: ['[[meetings/2026-06-18-leadership]]']
---

# No on-prem

We will not build [[blocks::themes/on-prem-deployment#Why|on-prem]]. Compare [[themes/enterprise-onboarding]].
`;

const UNRELATED = `---
type: note
summary: A scratch note.
---

Nothing here links to a theme.
`;

function workspace() {
  return world({
    'themes/index.md': '# Themes\n\n* [Enterprise Onboarding](themes/enterprise-onboarding.md)\n',
    'themes/enterprise-onboarding.md': THEME_ONBOARDING,
    'themes/on-prem-deployment.md': THEME_ON_PREM,
    'understanding/index.md': '# Understanding\n',
    'understanding/what-goes-here.md': WHAT_GOES_HERE,
    'understanding/product.md': UNDERSTANDING_PRODUCT,
    'insights/enterprise-buyers-gate-on-sso.md': INSIGHT,
    'decisions/2026-06-18-no-on-prem.md': DECISION,
    'notes/scratch.md': UNRELATED,
  });
}

test('themes and understanding pages move into research/, and the old folders go', async () => {
  const w = workspace();
  const result = await migrateThemesToResearch(w.ctx);

  assert.deepEqual(result.themes, [
    'themes/enterprise-onboarding.md',
    'themes/on-prem-deployment.md',
  ]);
  assert.deepEqual(result.understanding, ['understanding/product.md']);
  assert.deepEqual(result.left, []);
  assert.deepEqual([...w.disk.keys()].sort(), [
    'decisions/2026-06-18-no-on-prem.md',
    'insights/enterprise-buyers-gate-on-sso.md',
    'notes/scratch.md',
    'research/enterprise-onboarding.md',
    'research/on-prem-deployment.md',
    'research/product.md',
  ]);
  assert.deepEqual(w.removedDirs, ['themes', 'understanding']);
  // The index follows the files rather than waiting for a rescan.
  assert.equal(w.indexed.has('themes/enterprise-onboarding.md'), false);
  assert.equal(w.indexed.has('understanding/product.md'), false);
  assert.ok(w.indexed.has('research/enterprise-onboarding.md'));
  assert.ok(w.indexed.has('research/product.md'));
});

test('a theme becomes a research page: type, sources, and the stance as the first line', async () => {
  const w = workspace();
  await migrateThemesToResearch(w.ctx);

  const page = parseNote(w.disk.get('research/enterprise-onboarding.md')!);
  assert.equal(page.frontmatter['type'], 'research');
  assert.equal('stance' in page.frontmatter, false);
  assert.equal('evidence' in page.frontmatter, false);
  // `evidence` and an existing `sources` merge, and every link now points at research.
  assert.deepEqual(page.frontmatter['sources'], [
    '[[sources/2026-05-18-nordkap-qbr]]',
    '[[insights/enterprise-buyers-gate-on-sso]]',
    '[[meetings/2026-05-18-nordkap-qbr]]',
  ]);
  assert.deepEqual(page.frontmatter['tags'], ['enterprise-auth']);
  assert.equal(
    page.frontmatter['summary'],
    'Enterprise onboarding gates every deal over 200 seats',
  );
  assert.equal(
    page.body,
    '# Enterprise onboarding\n\nStance: committed.\n\nEnterprise buyers cannot get us through their own IT process. See [[research/on-prem-deployment]].\n',
  );
});

test("a wont-do theme says won't do and names the decision that pointed at it", async () => {
  const w = workspace();
  await migrateThemesToResearch(w.ctx);

  const page = parseNote(w.disk.get('research/on-prem-deployment.md')!);
  assert.equal(page.frontmatter['type'], 'research');
  assert.deepEqual(page.frontmatter['sources'], ['[[insights/on-prem-asked-twice]]']);
  assert.ok(
    page.body.startsWith(
      "# On-prem deployment\n\nStance: won't do. Decided in [[decisions/2026-06-18-no-on-prem]].\n\n",
    ),
    page.body,
  );
});

test('an understanding page keeps everything but its type, and what-goes-here goes', async () => {
  const w = workspace();
  await migrateThemesToResearch(w.ctx);

  const page = parseNote(w.disk.get('research/product.md')!);
  assert.equal(page.frontmatter['type'], 'research');
  assert.equal(page.frontmatter['title'], 'Product');
  assert.deepEqual(page.frontmatter['sources'], []);
  assert.equal(
    page.body,
    '# Product\n\nA scheduling tool for field teams. Relates to [[research/technical]].\n',
  );
  assert.equal(w.disk.has('understanding/what-goes-here.md'), false);
  assert.equal(w.disk.has('research/what-goes-here.md'), false);
});

test('links across the workspace follow the move, typed links and aliases included', async () => {
  const w = workspace();
  const result = await migrateThemesToResearch(w.ctx);

  assert.deepEqual(result.rewritten.sort(), [
    'decisions/2026-06-18-no-on-prem.md',
    'insights/enterprise-buyers-gate-on-sso.md',
  ]);
  const decision = w.disk.get('decisions/2026-06-18-no-on-prem.md')!;
  assert.ok(decision.includes('[[blocks::research/on-prem-deployment#Why|on-prem]]'), decision);
  assert.ok(decision.includes('Compare [[research/enterprise-onboarding]].'), decision);
  const insight = w.disk.get('insights/enterprise-buyers-gate-on-sso.md')!;
  assert.ok(insight.includes('[[research/enterprise-onboarding|the onboarding case]]'), insight);
  assert.ok(!decision.includes('themes/') && !insight.includes('themes/'));
  // A file with nothing to rewrite is not written.
  assert.equal(w.disk.get('notes/scratch.md'), UNRELATED);
});

test('the theme back-pointer folds into sources on a decision and is dropped from an insight', async () => {
  const w = workspace();
  await migrateThemesToResearch(w.ctx);

  const decision = parseNote(w.disk.get('decisions/2026-06-18-no-on-prem.md')!);
  assert.equal('theme' in decision.frontmatter, false);
  assert.deepEqual(decision.frontmatter['sources'], [
    '[[meetings/2026-06-18-leadership]]',
    '[[research/on-prem-deployment]]',
  ]);
  assert.equal(decision.frontmatter['standing'], 'active');

  const insight = parseNote(w.disk.get('insights/enterprise-buyers-gate-on-sso.md')!);
  assert.equal('theme' in insight.frontmatter, false);
  assert.equal('sources' in insight.frontmatter, false);
  assert.deepEqual(insight.frontmatter['evidence'], ['[[sources/2026-05-18-nordkap-qbr]]']);
  assert.equal(insight.frontmatter['confidence'], 'high');
});

test('one commit for the whole move, and one Activity row without a put-back', async () => {
  const w = workspace();
  const result = await migrateThemesToResearch(w.ctx);

  assert.equal(w.commits.length, 1);
  assert.equal(w.commits[0]!.message, RESEARCH_MIGRATION_COMMIT);
  assert.deepEqual([...w.commits[0]!.paths].sort(), [...result.changed].sort());
  for (const path of [
    'themes/enterprise-onboarding.md',
    'research/enterprise-onboarding.md',
    'themes/index.md',
    'understanding/index.md',
    'understanding/what-goes-here.md',
    'understanding/product.md',
    'research/product.md',
    'decisions/2026-06-18-no-on-prem.md',
  ]) {
    assert.ok(w.commits[0]!.paths.includes(path), path);
  }

  assert.equal(w.rows.length, 1);
  const row = w.rows[0]!;
  assert.equal(row.line, 'I moved 2 themes and 1 understanding page into Research.');
  assert.equal(row.action, 'updated');
  assert.equal(row.path, null);
  assert.equal(row.sessionId, null);
  assert.equal(row.revert.commit, null);
  assert.ok(row.reason.endsWith('.') && !row.reason.includes('—'));
});

test('the Activity line counts what moved and leaves out what did not', () => {
  assert.equal(
    researchMigrationLine(4, 3),
    'I moved 4 themes and 3 understanding pages into Research.',
  );
  assert.equal(researchMigrationLine(1, 0), 'I moved 1 theme into Research.');
  assert.equal(researchMigrationLine(0, 1), 'I moved 1 understanding page into Research.');
});

test('running it twice is running it once', async () => {
  const w = workspace();
  await migrateThemesToResearch(w.ctx);
  const after = new Map(w.disk);

  const second = await migrateThemesToResearch(w.ctx);
  assert.deepEqual(second, { themes: [], understanding: [], rewritten: [], left: [], changed: [] });
  assert.deepEqual([...w.disk.entries()], [...after.entries()]);
  assert.equal(w.commits.length, 1);
  assert.equal(w.rows.length, 1);
});

test('a workspace that never had the old folders is not touched', async () => {
  const w = world({ 'research/competitors.md': UNRELATED, 'notes/scratch.md': UNRELATED });
  const result = await migrateThemesToResearch(w.ctx);
  assert.deepEqual(result.changed, []);
  assert.equal(w.commits.length, 0);
  assert.equal(w.rows.length, 0);
  assert.deepEqual(w.removedDirs, []);
});

test('a page research/ already has by that name is left where it is, folder and all', async () => {
  const w = world({
    'themes/index.md': '# Themes\n',
    'themes/pricing.md': THEME_ON_PREM,
    'research/pricing.md': UNRELATED,
    'themes/mobile.md': THEME_ONBOARDING,
  });
  const result = await migrateThemesToResearch(w.ctx);

  assert.deepEqual(result.left, ['themes/pricing.md']);
  assert.deepEqual(result.themes, ['themes/mobile.md']);
  assert.equal(w.disk.get('themes/pricing.md'), THEME_ON_PREM);
  assert.equal(w.disk.get('research/pricing.md'), UNRELATED);
  // The folder stays, index included, so nothing is stranded without its map.
  assert.equal(w.disk.has('themes/index.md'), true);
  assert.deepEqual(w.removedDirs, []);
});

test('a body with no heading gets the stance line at the top', async () => {
  const w = world({
    'themes/x.md': '---\ntype: theme\nsummary: X\nstance: exploring\n---\n\nJust a paragraph.\n',
  });
  await migrateThemesToResearch(w.ctx);
  assert.equal(
    parseNote(w.disk.get('research/x.md')!).body,
    'Stance: exploring.\n\nJust a paragraph.\n',
  );
});
