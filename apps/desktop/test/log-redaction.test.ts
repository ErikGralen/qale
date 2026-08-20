import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  failureReport,
  installLogCapture,
  recentLog,
  redactLogLine,
  registerSecretValue,
  resetLogForTest,
  resetSecretsForTest,
} from '../src/main/log.js';

/** The one guarantee diagnostics makes: nothing in a captured line is theirs. */
test('redacts what a log line can leak', () => {
  const cases: [string, string][] = [
    [
      '[git] add failed for /Users/ada/Product Notes/meetings/pricing-call.md',
      '[git] add failed for <path> <note>',
    ],
    [
      '[qale] moved skills/weekly-update/SKILL.md into a folder',
      '[qale] moved <note> into a folder',
    ],
    [
      '[qale] sync: pull failed for ada.lovelace@northwind.example',
      '[qale] sync: pull failed for <email>',
    ],
    [
      '[qale] POST https://northwind.atlassian.net/wiki/spaces/PROD/pages/9/Q3+Pricing',
      '[qale] POST https://<host><path>',
    ],
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

/**
 * The value pass: a credential we hold goes by its exact value, before any
 * shape rule gets a say. The token below is deliberately shapeless — under 24
 * characters, no digit, no slash — so nothing but the value pass can catch it.
 */
test('blanks a registered credential in any shape', () => {
  resetSecretsForTest();
  const token = 'lingonberry-syltkaka';
  // Control: this is exactly what the shape rules let through.
  assert.equal(redactLogLine(`[qale] atlassian auth ${token}`), `[qale] atlassian auth ${token}`);

  registerSecretValue(token);
  assert.equal(redactLogLine(`[qale] atlassian auth ${token}`), '[qale] atlassian auth <redacted>');
  // Every occurrence, not just the first.
  assert.equal(
    redactLogLine(`[qale] auth ${token} failed, retried with ${token}`),
    '[qale] auth <redacted> failed, retried with <redacted>',
  );
  // Inside a JSON body, with no whitespace or word boundary around it.
  assert.equal(
    redactLogLine(`[qale] token response {"access_token":"${token}","expires_in":3599}`),
    '[qale] token response {"access_token":"<redacted>","expires_in":3599}',
  );
  // And inside the one URL we keep readable, which is where the MCP token shows up.
  assert.equal(
    redactLogLine(`[qale] MCP handshake http://127.0.0.1:7717/mcp?token=${token}`),
    '[qale] MCP handshake http://127.0.0.1:7717/mcp?token=<redacted>',
  );
});

/** Registered first means registered first: a shape rule must not get there
 *  and leave a friendlier-looking placeholder behind. */
test('the value pass runs before the shape rules', () => {
  resetSecretsForTest();
  registerSecretValue('roadmap/nordkap-pricing');
  assert.equal(
    redactLogLine('[qale] webhook roadmap/nordkap-pricing'),
    '[qale] webhook <redacted>',
  );
});

/** Rotation: the new token starts being blanked, the old one never stops —
 *  lines written before the rotation are still sitting in the buffer. */
test('a rotated credential keeps redacting the value it replaced', () => {
  resetSecretsForTest();
  registerSecretValue('old-hjortron-token');
  registerSecretValue('new-hjortron-token');
  assert.equal(
    redactLogLine('[qale] refresh old-hjortron-token → new-hjortron-token'),
    '[qale] refresh <redacted> → <redacted>',
  );
});

/** A short or missing "secret" is more likely a word, and blanking every
 *  occurrence of it would mangle ordinary lines. */
test('ignores empty and very short values', () => {
  resetSecretsForTest();
  for (const value of ['', '   ', 'sync', null, undefined]) registerSecretValue(value);
  assert.equal(
    redactLogLine('[qale] sync run finished with no changes'),
    '[qale] sync run finished with no changes',
  );
});

test('console is captured, scrubbed, and kept in order', () => {
  resetSecretsForTest();
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

/**
 * OW3's second half. A background pass reports what it could not do ONCE, at
 * the end, naming each item and its reason — never a row per failure, and never
 * a swallow.
 */
test('every failure a pass hit comes out as one scrubbed line', () => {
  resetSecretsForTest();
  const line = failureReport('librarian', [
    { item: 'connector sync', reason: new Error('pull failed for ada@northwind.example') },
    { item: 'orientation maps', reason: new Error('could not write /Users/ada/w/themes/index.md') },
    { item: 'new-space survey', reason: 'timed out' },
  ]);

  assert.equal(
    line,
    '[qale] librarian: 3 items failed this pass — connector sync (pull failed for <email>);' +
      ' orientation maps (could not write <path>); new-space survey (timed out)',
  );
});

test('a pass that went through clean has no line to write', () => {
  assert.equal(failureReport('librarian', []), null);
});

test('one failure is counted as one, not as "1 items"', () => {
  assert.equal(
    failureReport('librarian', [{ item: 'connector sync', reason: new Error('offline') }]),
    '[qale] librarian: 1 item failed this pass — connector sync (offline)',
  );
});
