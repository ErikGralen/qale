import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startedByNobody } from '../src/runtime.js';

/**
 * Which runs hide behind the Sessions page's Automatic filter. The rule is who
 * ASKED, not who was watching: dropping a source is an ask, and the session it
 * starts has to be on the list and the rail when the PM comes back for it.
 */

test('a clock’s own run is automatic', () => {
  assert.equal(startedByNobody({ scheduled: true }), true);
  // The librarian pass: a tick started it, but it keeps `ask_user`, so it says
  // `unattended` rather than `scheduled` and names itself automatic instead.
  assert.equal(startedByNobody({ unattended: true, automatic: true }), true);
});

test('a source the PM dropped is not automatic, however quiet the run is', () => {
  assert.equal(startedByNobody({ unattended: true, automatic: false }), false);
  assert.equal(startedByNobody({ unattended: true }), false);
});

test('a person’s own message clears the mark', () => {
  assert.equal(startedByNobody({}), false);
});
