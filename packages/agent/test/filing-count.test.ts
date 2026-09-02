import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultBoundaryError, type UseCaseContext } from '@qale/application';
import type { SessionHarness } from '@qale/sessions';
import { createFilingTools, type SourceFiled } from '../src/filing.js';

/**
 * CM-2: the count behind the line the PM watches while a dropped pile is read.
 * It has to come from filings that happened: a batch that says "9 filed" when
 * the vault refused nine writes is the one failure this hook can have.
 */

function sessionRoot(files: Record<string, string>): string {
  const root = join(mkdtempSync(join(tmpdir(), 'pm-count-')), 'sessions/.files/s1');
  mkdirSync(join(root, 'source'), { recursive: true });
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(root, 'source', name), body);
  return root;
}

/** A vault that takes every write, and remembers what it took. */
function writingCtx(): UseCaseContext & { wrote: string[] } {
  const wrote: string[] = [];
  return {
    vault: {
      root: () => '/fake',
      readNote: async () => null,
      readRaw: async () => null,
      writeNote: async (path: string, body: string) => {
        wrote.push(path);
        return { path, type: 'source', frontmatter: {}, body };
      },
      writeRaw: async (path: string) => {
        wrote.push(path);
      },
      writeBinary: async (path: string) => {
        wrote.push(path);
      },
      remove: async () => {},
      exists: async () => false,
      list: async () => [],
      contain: () => null,
    },
    index: { reindex: () => {}, removeByPath: () => {}, get: () => null, all: () => [] },
    git: { commitPaths: async () => {} },
    clock: { now: () => '2026-08-31T09:00:00.000Z' },
    wrote,
  } as unknown as UseCaseContext & { wrote: string[] };
}

/** A vault that turns every write down, the OW8 case. */
function refusingCtx(): UseCaseContext {
  const ctx = writingCtx();
  const refuse = async (path: string) => {
    throw new VaultBoundaryError(path);
  };
  const vault = (ctx as unknown as { vault: Record<string, unknown> }).vault;
  vault.writeNote = refuse;
  vault.writeRaw = refuse;
  vault.writeBinary = refuse;
  return ctx;
}

const harness = { fileSource: true, recordRead: () => {} } as unknown as SessionHarness;

const run = (tool: { execute: (...a: never[]) => unknown }, params: unknown) =>
  (
    tool.execute as unknown as (
      id: string,
      p: unknown,
      s?: AbortSignal,
    ) => Promise<{ content: { text: string }[] }>
  )('call-1', params, undefined);

test('a filing reports the pieces it took off the pile', async () => {
  const root = sessionRoot({ 'a.txt': 'first call', 'b.txt': 'second call' });
  const counted: SourceFiled[] = [];
  const [file] = createFilingTools(writingCtx(), harness, root, (filed) => counted.push(filed));

  await run(file!, {
    files: ['source/a.txt', 'source/b.txt'],
    as: 'source',
    title: 'Two interviews',
  });

  assert.deepEqual(counted, [{ pieces: 2, matched: false }]);
});

test('a refused write is never counted', async () => {
  const root = sessionRoot({ 'a.txt': 'they said the thing' });
  const counted: SourceFiled[] = [];
  const [file] = createFilingTools(refusingCtx(), harness, root, (filed) => counted.push(filed));

  await run(file!, { files: ['source/a.txt'], as: 'source', title: 'Nordkap QBR' }).then(
    () => undefined,
    () => undefined,
  );

  assert.deepEqual(counted, []);
});

test('a session that may not file a source counts nothing', async () => {
  const root = sessionRoot({ 'a.txt': 'they said the thing' });
  const counted: SourceFiled[] = [];
  const [file] = createFilingTools(
    writingCtx(),
    { fileSource: false, recordRead: () => {} } as unknown as SessionHarness,
    root,
    (filed) => counted.push(filed),
  );

  await run(file!, { files: ['source/a.txt'], as: 'source', title: 'Nordkap QBR' });

  assert.deepEqual(counted, []);
});
