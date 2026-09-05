import { test } from 'node:test';
import assert from 'node:assert/strict';
import { documentsFolder, locationCrumbs, shelfLabel } from '../src/renderer/src/lib/crumbs.js';

test('a document reads Documents and opens the Documents root', () => {
  assert.deepEqual(locationCrumbs('notes/spec.md', 'note'), [
    { label: 'Documents', target: { kind: 'documents', folder: '' } },
  ]);
});

test('a document in a folder names every level, and each one opens it', () => {
  assert.deepEqual(locationCrumbs('notes/specs/api/spec.md', 'note'), [
    { label: 'Documents', target: { kind: 'documents', folder: '' } },
    { label: 'specs', target: { kind: 'documents', folder: 'specs' } },
    { label: 'api', target: { kind: 'documents', folder: 'specs/api' } },
  ]);
});

test('a meeting reads Calendar, never a folder', () => {
  assert.deepEqual(locationCrumbs('meetings/2026-09-01-standup.md', 'meeting'), [
    { label: 'Calendar', target: { kind: 'calendar' } },
  ]);
});

test('a memory page reads its shelf and opens the folder', () => {
  assert.deepEqual(locationCrumbs('themes/onboarding.md', 'theme'), [
    { label: 'Themes', target: { kind: 'folder', dir: 'themes' } },
  ]);
  assert.deepEqual(locationCrumbs('people/erik.md', 'person'), [
    { label: 'People', target: { kind: 'folder', dir: 'people' } },
  ]);
  assert.deepEqual(locationCrumbs('sources/call.md', 'source'), [
    { label: 'Sources', target: { kind: 'folder', dir: 'sources' } },
  ]);
});

test('a mirror reads its system and its kind, never Memory', () => {
  // The system opens its own folder, the one the rail row opens. The kind after
  // it only says what that folder holds, so it is text.
  assert.deepEqual(locationCrumbs('tickets/jira/PAY-142.md', 'ticket'), [
    { label: 'Jira', target: { kind: 'folder', dir: 'tickets/jira' } },
    { label: 'Tickets' },
  ]);
  assert.deepEqual(locationCrumbs('wikipages/confluence/scim.md', 'wikipage'), [
    { label: 'Confluence', target: { kind: 'folder', dir: 'wikipages/confluence' } },
    { label: 'Pages' },
  ]);
});

test('a system nobody has a name for keeps its folder name, capitalised', () => {
  assert.deepEqual(locationCrumbs('tickets/linear/PAY-142.md', 'ticket'), [
    { label: 'Linear', target: { kind: 'folder', dir: 'tickets/linear' } },
    { label: 'Tickets' },
  ]);
});

test('a flat mirror names no system, so the kind is all the crumb says', () => {
  assert.deepEqual(locationCrumbs('tickets/PAY-142.md', 'ticket'), [
    { label: 'Tickets', target: { kind: 'folder', dir: 'tickets' } },
  ]);
});

test('an understanding file carries type note but never claims Documents', () => {
  assert.deepEqual(locationCrumbs('understanding/product.md', 'note'), [
    { label: 'Understanding', target: { kind: 'folder', dir: 'understanding' } },
  ]);
});

test('the type comes from the path when the page has none', () => {
  assert.deepEqual(locationCrumbs('notes/spec.md'), [
    { label: 'Documents', target: { kind: 'documents', folder: '' } },
  ]);
  assert.deepEqual(locationCrumbs('meetings/standup.md'), [
    { label: 'Calendar', target: { kind: 'calendar' } },
  ]);
});

test('a file at the workspace root has nothing above it to name', () => {
  assert.deepEqual(locationCrumbs('README.md', 'note'), []);
});

test('a folder wears the shelf name, not the name on disk', () => {
  assert.equal(shelfLabel('notes'), 'Documents');
  assert.equal(shelfLabel('people'), 'People');
  assert.equal(shelfLabel('themes'), 'Themes');
  assert.equal(shelfLabel('tickets'), 'Tickets');
  assert.equal(shelfLabel('understanding'), 'Understanding');
});

test('the notes dir is a Documents folder, everything else is not', () => {
  assert.equal(documentsFolder('notes'), '');
  assert.equal(documentsFolder('notes/specs'), 'specs');
  assert.equal(documentsFolder('notes/specs/api'), 'specs/api');
  assert.equal(documentsFolder('themes'), null);
  assert.equal(documentsFolder('notebooks'), null);
});
