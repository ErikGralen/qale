import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { AgentRuntime } from '../src/runtime.js';

/**
 * The naming pass end to end, with only the model call stood in for: what comes
 * back has to reach the name the PM sees, the transcript it is read from after a
 * restart, and the push that retitles an open tab — or none of them.
 */

const user = (text: string) => ({ role: 'user' as const, content: text, timestamp: 1 });
/** pi keeps a transcript in memory until an assistant message lands, then flushes
 *  the lot — so a session has to have answered before anything is on disk. */
const assistant = (text: string) => ({
  role: 'assistant' as const,
  content: [{ type: 'text', text }],
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'claude-test',
  usage: {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: 'stop',
  timestamp: 2,
});

/** The private surface these tests drive; `private` is a compile-time word. */
interface Innards {
  completeCheaply(systemPrompt: string, prompt: string): Promise<string | null>;
  nameSession(state: unknown, prompt: string, ctx: unknown): Promise<void>;
}

function harnessFor(answer: string | null) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'pm-userdata-'));
  const vaultDir = mkdtempSync(join(tmpdir(), 'pm-vault-'));
  const id = 'eeeeeeee-1111-2222-3333-444444444444';
  const manager = SessionManager.create(vaultDir, join(userDataDir, 'sessions'), { id });
  manager.appendMessage(
    user('Which customers care about SCIM, and did any of them ask twice?') as never,
  );
  manager.appendMessage(assistant('Acme and Globex.') as never);

  const runtime = new AgentRuntime();
  runtime.configure({ vaultDir, userDataDir, modelId: 'claude-test', apiKey: null });
  const inner = runtime as unknown as Innards;

  let asked = '';
  inner.completeCheaply = async (_systemPrompt, prompt) => {
    asked = prompt;
    return answer;
  };
  const renamed: { sessionId: string; title: string }[] = [];
  runtime.onRename = (r) => renamed.push(r);

  const state = {
    id,
    manager,
    title: 'Which customers care about SCIM, and did any of them ask twice?',
    named: true,
    harness: { invoked: [{ name: 'meeting-prep', title: 'Meeting prep' }] },
  };
  const ctx = { index: { get: (path: string) => ({ title: `Title of ${path}` }) } };

  return {
    runtime,
    name: (prompt: string) => inner.nameSession(state, prompt, ctx),
    state,
    renamed,
    prompt: () => asked,
    cleanup: () => {
      rmSync(userDataDir, { recursive: true, force: true });
      rmSync(vaultDir, { recursive: true, force: true });
    },
  };
}

test('a named session says so on screen, on disk, and to the open tab', async () => {
  const h = harnessFor('  **Nordkap SSO renewal**\n\nHope that helps!');
  try {
    await h.name('Which customers care about SCIM, and did any of them ask twice?');

    // On screen: the live rail and every status push read this.
    assert.equal(h.state.title, 'Nordkap SSO renewal');
    // On disk: the only place a name survives a restart.
    assert.equal(h.state.manager.getSessionName(), 'Nordkap SSO renewal');
    assert.equal((await h.runtime.listChats())[0]!.title, 'Nordkap SSO renewal');
    // And to the tab, once.
    assert.deepEqual(h.renamed, [{ sessionId: h.state.id, title: 'Nordkap SSO renewal' }]);
    // The message itself is what the namer read.
    assert.match(h.prompt(), /First message:\nWhich customers care about SCIM/);
  } finally {
    h.cleanup();
  }
});

test('a kickoff is named off the skill and the pages, never the machine prose', async () => {
  const h = harnessFor('Nordkap check-in prep');
  try {
    await h.name('Run the meeting-prep skill on meetings/2026-07-30-nordkap.md.');

    assert.match(h.prompt(), /"Meeting prep" skill/);
    assert.match(h.prompt(), /Title of meetings\/2026-07-30-nordkap\.md/);
    assert.doesNotMatch(h.prompt(), /Run the meeting-prep skill/);
    assert.equal(h.state.title, 'Nordkap check-in prep');
  } finally {
    h.cleanup();
  }
});

test('an answer that is not a name changes nothing at all', async () => {
  const h = harnessFor(
    "I'm sorry, but I can't help with naming this particular conversation for you.",
  );
  const before = h.state.title;
  try {
    await h.name('Which customers care about SCIM, and did any of them ask twice?');

    assert.equal(h.state.title, before);
    assert.equal(h.state.manager.getSessionName(), undefined);
    assert.deepEqual(h.renamed, []);
  } finally {
    h.cleanup();
  }
});

test('a model that could not be reached leaves the first-message name alone', async () => {
  const h = harnessFor(null);
  const before = h.state.title;
  try {
    await h.name('Which customers care about SCIM, and did any of them ask twice?');

    assert.equal(h.state.title, before);
    assert.equal(h.state.manager.getSessionName(), undefined);
    assert.deepEqual(h.renamed, []);
  } finally {
    h.cleanup();
  }
});
