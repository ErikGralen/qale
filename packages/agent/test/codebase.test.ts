import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CodebaseRepoRef, CodebaseRunRequest, CodebaseRunResult } from '@qale/application';
import {
  buildReport,
  createCodebaseTool,
  nextReportPath,
  planCodebaseAsk,
  type CodebaseAsk,
  type CodebaseAskInput,
  type CodebaseDecision,
  type IssuedSession,
} from '../src/codebase.js';

const REPOS: CodebaseRepoRef[] = [
  { name: 'checkout', dir: '/code/checkout' },
  { name: 'billing', dir: '/code/billing' },
];

const ASK: CodebaseAskInput = {
  question: 'Does the importer de-duplicate rows before writing?',
  repo: 'checkout',
  suggested_model: 'sonnet',
  why: 'One question about one file, so the cheap model is enough.',
};

const plan = (
  input: Partial<CodebaseAskInput>,
  issued: Map<string, IssuedSession> = new Map(),
): CodebaseAsk => {
  const r = planCodebaseAsk({ ...ASK, ...input }, REPOS, issued);
  if ('error' in r) throw new Error(r.error);
  return r.ask;
};
const err = (
  input: Partial<CodebaseAskInput>,
  issued: Map<string, IssuedSession> = new Map(),
  repos = REPOS,
): string => {
  const r = planCodebaseAsk({ ...ASK, ...input }, repos, issued);
  if (!('error' in r)) throw new Error('expected a rejection');
  return r.error;
};

const run = (tool: { execute: unknown }, params: unknown, signal?: AbortSignal) =>
  (
    tool.execute as (
      id: string,
      p: unknown,
      s?: AbortSignal,
    ) => Promise<{ content: { text: string }[] }>
  )('call-1', params, signal);

const RESULT: CodebaseRunResult = {
  text: 'It does not. `importRows` writes straight through.',
  sessionId: 'cc-1',
  commit: 'abc1234',
  branch: 'main',
  freshened: true,
};

/** A tool with every dep stubbed, and a record of what reached each one. */
function harness(over: {
  decision?: CodebaseDecision;
  result?: CodebaseRunResult | Error;
  repos?: CodebaseRepoRef[];
  filed?: string[];
}) {
  const ran: CodebaseRunRequest[] = [];
  const written: { path: string; content: string }[] = [];
  const shown: CodebaseAsk[] = [];
  const tool = createCodebaseTool({
    repos: async () => over.repos ?? REPOS,
    requestApproval: async (ask) => {
      shown.push(ask);
      return over.decision ?? { approved: true, modelId: 'opus' };
    },
    run: async (req) => {
      ran.push(req);
      if (over.result instanceof Error) throw over.result;
      return over.result ?? RESULT;
    },
    filed: async () => over.filed ?? [],
    write: async (path, content) => {
      written.push({ path, content });
    },
    now: () => '2026-08-23T09:00:00Z',
  });
  return { tool, ran, written, shown };
}

test('a question is validated against the repos that are actually set up', () => {
  assert.equal(plan({}).repo.dir, '/code/checkout');
  assert.match(err({ repo: 'ledger' }), /no repo called "ledger".*checkout, billing/s);
  assert.match(err({ repo: '' }), /repo is required.*checkout, billing/s);
  assert.match(err({ question: '  ' }), /question is required/);
  assert.match(err({ why: '' }), /why is required/);
  assert.match(err({}, new Map(), []), /No repo is set up/);
});

test('a model the claude tool does not take is refused, with the ones it does', () => {
  assert.match(err({ suggested_model: 'claude-opus-5' }), /not a model Claude Code takes/);
  assert.match(err({ suggested_model: 'claude-opus-5' }), /sonnet, opus, fable/);
  assert.equal(plan({ suggested_model: 'fable' }).modelId, 'fable');
});

test('a resume id this conversation never saw is refused rather than passed on', () => {
  assert.match(err({ resume: 'made-up' }), /have not had an answer from session made-up/);

  const issued = new Map<string, IssuedSession>([['cc-1', { repo: 'billing', modelId: 'sonnet' }]]);
  assert.match(
    err({ resume: 'cc-1', repo: 'checkout' }, issued),
    /read billing, not checkout/,
    'a session stays in the repo it started in',
  );
  assert.equal(plan({ resume: 'cc-1', repo: 'billing' }, issued).resumeSessionId, 'cc-1');
});

test('switching models means a new session, and the refusal says so', () => {
  const issued = new Map<string, IssuedSession>([
    ['cc-1', { repo: 'checkout', modelId: 'sonnet' }],
  ]);
  const message = err({ resume: 'cc-1', suggested_model: 'opus' }, issued);
  assert.match(message, /runs on sonnet and keeps it/);
  assert.match(message, /leave resume out to start a new session on opus/);
});

test('nothing runs until the PM approves, and a "not now" spends nothing', async () => {
  const { tool, ran, written } = harness({ decision: { approved: false } });
  const out = await run(tool, ASK);
  assert.equal(ran.length, 0, 'not one run started');
  assert.equal(written.length, 0, 'and nothing was filed');
  assert.match(out.content[0]!.text, /did not approve/);
});

test('a scheduled run is refused outright, and told to carry on without it', async () => {
  const { tool, ran } = harness({ decision: { approved: false, unattended: true } });
  const out = await run(tool, ASK);
  assert.equal(ran.length, 0);
  assert.match(out.content[0]!.text, /Nobody is here to approve this/);
  assert.match(out.content[0]!.text, /this part is unchecked/);
});

test('the card picks the model, and the run gets the repo it named', async () => {
  const { tool, ran, shown } = harness({ decision: { approved: true, modelId: 'opus' } });
  await run(tool, ASK);
  assert.equal(shown[0]!.modelId, 'sonnet', 'the card shows what the session suggested');
  assert.equal(ran[0]!.modelId, 'opus', 'the run uses what the PM picked');
  assert.equal(ran[0]!.repoDir, '/code/checkout');
  assert.equal(ran[0]!.prompt, ASK.question);
  assert.equal(ran[0]!.resumeSessionId, undefined);
});

test('a failed run is one line of tool text, never a thrown turn', async () => {
  const { tool, written } = harness({ result: new Error('claude exited with code 1') });
  const out = await run(tool, ASK);
  assert.match(out.content[0]!.text, /did not run: claude exited with code 1/);
  assert.match(out.content[0]!.text, /Nothing was filed/);
  assert.equal(written.length, 0);
});

test('the answer is filed with its provenance and comes back wrapped', async () => {
  const { tool, written } = harness({ filed: ['codebase/01-checkout-old.md'] });
  const out = await run(tool, ASK);

  const filed = written[0]!;
  assert.match(filed.path, /^codebase\/02-checkout-does-the-importer-de-duplicate-rows\.md$/);
  assert.match(filed.content, /- Repo: checkout \(\/code\/checkout\)/);
  assert.match(filed.content, /- Commit: abc1234 on main/);
  assert.match(filed.content, /- Code: pulled right before the run/);
  assert.match(filed.content, /- Asked: 2026-08-23/);
  assert.match(filed.content, /- Model: opus/, 'the model that ran, not the one suggested');
  assert.match(filed.content, /- Claude Code session: cc-1/);
  assert.match(filed.content, /It does not\./);

  const text = out.content[0]!.text;
  assert.match(text, /codebase\/02-checkout-/);
  assert.match(text, /Claude Code session cc-1/);
  const open = /<<<EXTERNAL_MATERIAL id=([0-9a-f]{8}) origin="claude-code:checkout">>>/.exec(text);
  assert.ok(open, `the answer is not fenced:\n${text}`);
  assert.match(text, new RegExp(`<<<END_EXTERNAL_MATERIAL id=${open[1]}>>>`));
});

test('a run that could not pull says so rather than letting the reader assume', () => {
  const report = buildReport(
    { question: 'q', repo: REPOS[0]!, modelId: 'sonnet', why: 'w' },
    { ...RESULT, freshened: false, skippedWhy: 'the working tree has uncommitted changes' },
    '2026-08-23',
  );
  assert.match(report, /- Code: not pulled \(the working tree has uncommitted changes\)/);
});

test('an answer makes its session resumable, and only in the repo it read', async () => {
  const { tool, ran } = harness({});
  await run(tool, ASK);
  const out = await run(tool, { ...ASK, suggested_model: 'opus', resume: 'cc-1' });
  assert.equal(ran.length, 2);
  assert.equal(ran[1]!.resumeSessionId, 'cc-1');

  const wrongRepo = await run(tool, { ...ASK, repo: 'billing', resume: 'cc-1' });
  assert.match(wrongRepo.content[0]!.text, /read checkout, not billing/);
  assert.equal(ran.length, 2, 'a refused resume never reaches the runner');
});

test('a resume runs on the model its session started with, card or no card', async () => {
  const ran: CodebaseRunRequest[] = [];
  const tool = createCodebaseTool({
    repos: async () => REPOS,
    // A new session gets a picker, and the PM moves this one to fable. A resume
    // has no picker, so its card comes back with an approval and nothing else.
    requestApproval: async (ask) =>
      ask.resumeSessionId ? { approved: true } : { approved: true, modelId: 'fable' },
    run: async (req) => {
      ran.push(req);
      return RESULT;
    },
    filed: async () => [],
    write: async () => {},
    now: () => '2026-08-23T09:00:00Z',
  });

  await run(tool, ASK);
  const followUp = await run(tool, { ...ASK, suggested_model: 'fable', resume: 'cc-1' });
  assert.equal(ran.length, 2, followUp.content[0]!.text);
  assert.equal(ran[1]!.resumeSessionId, 'cc-1');
  assert.equal(ran[1]!.modelId, 'fable', 'the session keeps the model it started on');
});

test('Stop reaches the run, and a stopped run files nothing', async () => {
  const stop = new AbortController();
  const { tool, ran, written } = harness({});
  const out = await run(tool, ASK, stop.signal);

  // The turn's signal goes down to the runner, which is what kills the `claude`
  // process instead of leaving ten minutes of it running for nobody.
  assert.equal(ran[0]!.signal, stop.signal);
  assert.equal(written.length, 1, 'a run nobody stopped is filed as usual');

  stop.abort();
  const stopped = await run(tool, ASK, stop.signal);
  assert.match(stopped.content[0]!.text, /stopped the run, so nothing was filed/);
  assert.equal(written.length, 1, 'the answer that landed on Stop is not written down');
  assert.match(out.content[0]!.text, /Filed as/);
});

test('reports keep counting from what is already on disk, not from one', () => {
  assert.equal(nextReportPath([], 'checkout', 'why'), 'codebase/01-checkout-why.md');
  assert.match(
    nextReportPath(['codebase/01-a.md', 'codebase/09-b.md', 'brief.md'], 'checkout', 'why'),
    /^codebase\/10-checkout-why\.md$/,
  );
});
