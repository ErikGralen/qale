import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultBoundaryError, type UseCaseContext } from '@qale/application';
import type { SessionHarness } from '@qale/sessions';
import { createFilingTools } from '../src/filing.js';

/**
 * OW8 — the filing tools are the one pair that writes to the memory without a
 * card, so they are the one pair where a refused path could be reported as a
 * filing that happened. It cannot: a tool that throws becomes a tool RESULT
 * marked as an error, carrying the message, which is what the model reads next
 * turn. Silence would leave it citing a note that was never written.
 */

function sessionRoot(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'pm-file-')), 'sessions/.files/s1');
  mkdirSync(join(root, 'material'), { recursive: true });
  writeFileSync(join(root, 'material/nordkap.txt'), 'they said the thing');
  return root;
}

/** Everything `captureDocument` touches, with the guard turning every write down. */
function refusingCtx(): UseCaseContext {
  return {
    vault: {
      root: () => '/fake',
      readNote: async () => null,
      readRaw: async () => null,
      writeNote: async (p: string) => {
        throw new VaultBoundaryError(p);
      },
      writeRaw: async (p: string) => {
        throw new VaultBoundaryError(p);
      },
      writeBinary: async (p: string) => {
        throw new VaultBoundaryError(p);
      },
      remove: async (p: string) => {
        throw new VaultBoundaryError(p);
      },
      exists: async () => false,
      list: async () => [],
      contain: () => null,
    },
    index: { reindex: () => {}, removeByPath: () => {}, get: () => null, all: () => [] },
    git: { commitPaths: async () => {} },
    clock: { now: () => '2026-08-07T09:00:00.000Z' },
  } as unknown as UseCaseContext;
}

const harness = { fileMaterial: true, recordRead: () => {} } as unknown as SessionHarness;

const run = (tool: { execute: (...a: never[]) => unknown }, params: unknown) =>
  (
    tool.execute as unknown as (
      id: string,
      p: unknown,
      s?: AbortSignal,
    ) => Promise<{ content: { text: string }[] }>
  )('call-1', params, undefined);

test('file_material never reports a filing the vault refused', async () => {
  const root = sessionRoot();
  const [file] = createFilingTools(refusingCtx(), harness, root);

  const outcome = await run(file!, {
    files: ['material/nordkap.txt'],
    as: 'source',
    title: 'Nordkap QBR',
  }).then(
    (res) => res.content[0]?.text ?? '',
    (err: unknown) => err,
  );

  // Not a cheerful "Filed to sources/…" the model would go on to cite.
  assert.ok(outcome instanceof Error, `expected a refusal, got: ${String(outcome)}`);
  assert.equal(outcome.name, 'VaultBoundaryError');
});
