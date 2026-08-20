import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NOTE_TYPES,
  editLayerForType,
  isBodyEditable,
  isMirrorType,
  mirrorSource,
  noteTypeLabel,
  providerLabel,
  readOnlyReason,
} from '../src/index.js';

/**
 * The user-facing half of the edit invariants (complexity ticket 4): one
 * ownership layer per type, derived from TYPE_RULES + NOTE_TYPE_META, and one
 * sentence per layer so every read-only surface says the same thing.
 */

test('every type lands in the layer its rules imply', () => {
  assert.equal(editLayerForType('note'), 'open');
  assert.equal(editLayerForType('meeting'), 'open');
  assert.equal(editLayerForType('source'), 'raw');
  assert.equal(editLayerForType('session'), 'receipt');
  assert.equal(editLayerForType('decision'), 'spine');
  assert.equal(editLayerForType('ticket'), 'mirror');
  assert.equal(editLayerForType('wikipage'), 'mirror');
});

test('the layer tracks editability: a sentence appears exactly when the cursor does not', () => {
  for (const type of NOTE_TYPES) {
    const open = editLayerForType(type) === 'open';
    assert.equal(open, isBodyEditable(type), `${type}: layer disagrees with TYPE_RULES`);
    assert.equal(readOnlyReason(type) === null, open, `${type}: sentence disagrees with layer`);
  }
});

test('mirrors name the system they copy, not our folder', () => {
  assert.equal(isMirrorType('ticket'), true);
  assert.equal(isMirrorType('wikipage'), true);
  assert.equal(isMirrorType('source'), false);

  assert.equal(mirrorSource('ticket'), 'Jira');
  assert.equal(mirrorSource('wikipage'), 'Confluence');
  assert.equal(mirrorSource('meeting'), null);

  assert.equal(noteTypeLabel('ticket'), 'Jira mirror');
  assert.equal(noteTypeLabel('wikipage'), 'Confluence mirror');
  assert.equal(noteTypeLabel('decision'), 'Decision');

  assert.equal(readOnlyReason('ticket'), 'Mirrored from Jira. Edits happen there.');
  assert.equal(readOnlyReason('wikipage'), 'Mirrored from Confluence. Edits happen there.');
});

test("a mirror's own provider field wins over the type default", () => {
  assert.equal(mirrorSource('ticket', { provider: 'linear' }), 'Linear');
  assert.equal(noteTypeLabel('ticket', { provider: 'linear' }), 'Linear mirror');
  // A meeting synced from a calendar is not a mirror type — it stays editable,
  // so its provider must not turn it into one.
  assert.equal(mirrorSource('meeting', { provider: 'google-calendar' }), null);
});

test('provider labels read as their product names', () => {
  assert.equal(providerLabel('jira'), 'Jira');
  assert.equal(providerLabel('confluence'), 'Confluence');
  assert.equal(providerLabel('google-calendar'), 'Google Calendar');
});

test('the read-only sentences stay short and plain', () => {
  assert.equal(readOnlyReason('source'), 'Raw material. Never rewritten.');
  assert.equal(
    readOnlyReason('session'),
    'A record of what happened. Kept exactly as it was filed.',
  );
  assert.equal(
    readOnlyReason('decision'),
    'Superseded, never edited. Write a new one to change course.',
  );
  for (const type of NOTE_TYPES) {
    const sentence = readOnlyReason(type);
    if (!sentence) continue;
    assert.ok(!sentence.includes('—'), `${type}: no em dashes in the read-only line`);
    assert.ok(!sentence.includes(';'), `${type}: no semicolon-joined clauses`);
    assert.ok(sentence.length <= 70, `${type}: "${sentence}" is too long for one quiet line`);
  }
});
