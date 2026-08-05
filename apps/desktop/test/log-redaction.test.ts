import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installLogCapture, recentLog, redactLogLine, resetLogForTest } from '../src/main/log.js';

/** The one guarantee diagnostics makes: nothing in a captured line is theirs. */
test('redacts what a log line can leak', () => {
  const cases: [string, string][] = [
    ['[git] add failed for /Users/ada/Product Notes/meetings/pricing-call.md', '[git] add failed for <path> <note>'],
    ['[qale] moved skills/weekly-update/SKILL.md into a folder', '[qale] moved <note> into a folder'],
    ['[qale] sync: pull failed for ada.lovelace@northwind.example', '[qale] sync: pull failed for <email>'],
    ['[qale] POST https://northwind.atlassian.net/wiki/spaces/PROD/pages/9/Q3+Pricing', '[qale] POST https://<host><path>'],
    ['[qale] MCP token: 8f21c4a90b7e4d1e9a3f6c2b5d80e714', '[qale] MCP token: <redacted>'],
    ['[qale] screenshot → file:///tmp/shot.png', '[qale] screenshot → <path>'],
    ['[qale] read C:\\Users\\Ada\\notes\\plan.md failed', '[qale] read <path> failed'],
    // A slug carries the note's title even with no folder and no extension.
    [
      '[qale] drift check failed (page-drift:wikipages/enterprise-onboarding:decisions/2026-05-20-adopt-workos): 401',
      '[qale] drift check failed (page-drift:<note>:<note>): 401',
    ],
  ];
  for (const [raw, want] of cases) assert.equal(redactLogLine(raw), want, raw);
});

/** The local server is ours, so its address stays readable. */
test('keeps the loopback address and ordinary prose', () => {
  assert.equal(
    redactLogLine('[qale] MCP server on http://127.0.0.1:7717/mcp'),
    '[qale] MCP server on http://127.0.0.1:7717/mcp',
  );
  assert.equal(
    redactLogLine('[qale] librarian sweep failed: index is locked'),
    '[qale] librarian sweep failed: index is locked',
  );
});

test('console is captured, scrubbed, and kept in order', () => {
  resetLogForTest();
  const original = console.error;
  // Silence first, then install: the capture wraps whatever it finds, so this
  // records without printing the deliberate failures into the test output.
  console.error = () => undefined;
  installLogCapture();
  try {
    console.error('[git] commit failed for /Users/ada/w/notes/secret-plan.md:', new Error('nope'));
    console.error('[qale] second line');
  } finally {
    console.error = original;
  }
  const { lines, total } = recentLog(10);
  assert.equal(total, 2);
  // An Error goes in as name and message: a stack is long and is all paths.
  assert.match(lines[0] ?? '', /ERROR \[git\] commit failed for <path>: Error: nope$/);
  assert.match(lines[1] ?? '', /ERROR \[qale\] second line$/);
});
