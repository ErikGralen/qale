import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PeopleDirectoryDTO, PersonCardDTO } from '@qale/ipc';
import { initials, nameFromEmail, resolveParticipant } from '../src/renderer/src/lib/people.js';

const sara: PersonCardDTO = {
  path: 'people/sara-lindqvist.md',
  slug: 'people/sara-lindqvist',
  name: 'Sara Lindqvist',
  summary: 'Head of IT at Nordkap',
  email: 'Sara.Lindqvist@nordkap.example',
};

const dir: PeopleDirectoryDTO = {
  people: [sara],
  self: { name: 'Erik Gralén', emails: ['egralen@gmail.com'] },
};

test('a wikilink participant resolves to the person, never to its target text', () => {
  for (const raw of [
    '[[people/sara-lindqvist]]',
    '[[sara-lindqvist]]',
    '[[people/sara-lindqvist|Sara]]',
  ]) {
    const p = resolveParticipant(raw, dir);
    assert.equal(p.kind, 'person', raw);
    assert.equal(p.label, 'Sara Lindqvist');
  }
});

test('a bare invite address resolves through the person page’s email, case-insensitively', () => {
  const p = resolveParticipant('sara.lindqvist@nordkap.example', dir);
  assert.equal(p.kind, 'person');
  assert.equal(p.label, 'Sara Lindqvist');
});

test('the PO is themselves — by connected address or by the "me" the vault writes', () => {
  assert.equal(resolveParticipant('egralen@gmail.com', dir).label, 'Erik Gralén');
  assert.equal(resolveParticipant('me', dir).label, 'Erik Gralén');
  // No name set yet: "You" beats an email address, always.
  const anon: PeopleDirectoryDTO = {
    people: [],
    self: { name: null, emails: ['egralen@gmail.com'] },
  };
  assert.equal(resolveParticipant('egralen@gmail.com', anon).label, 'You');
  assert.equal(resolveParticipant('egralen@gmail.com', anon).kind, 'self');
});

test('an unfiled attendee keeps their address as the label but carries a suggested name', () => {
  const p = resolveParticipant('tom.devlin@tavla.io', dir);
  assert.equal(p.kind, 'unknown');
  assert.equal(p.label, 'tom.devlin@tavla.io');
  assert.equal(p.kind === 'unknown' ? p.name : null, 'Tom Devlin');
});

test('a dangling people link reads as a name — the page is what is missing, not the person', () => {
  const p = resolveParticipant('[[people/johanna-berg]]', dir);
  assert.equal(p.kind, 'unknown');
  assert.equal(p.label, 'Johanna Berg');
});

test('no directory yet (first paint) still never shows brackets', () => {
  assert.equal(resolveParticipant('[[people/sara-lindqvist]]', null).label, 'Sara Lindqvist');
  assert.equal(resolveParticipant('Tom Devlin', null).label, 'Tom Devlin');
});

test('initials cope with names, addresses and single words', () => {
  assert.equal(initials('Sara Lindqvist'), 'SL');
  assert.equal(initials('tom.devlin@tavla.io'), 'TD');
  // One word is one letter (Tom, or a handle) — never a random second glyph.
  assert.equal(initials('egralen@gmail.com'), 'E');
  assert.equal(initials('Tom'), 'T');
});

test('nameFromEmail is a decent guess, not a mangling', () => {
  assert.equal(nameFromEmail('sara.lindqvist@nordkap.example'), 'Sara Lindqvist');
  assert.equal(nameFromEmail('tom_devlin@tavla.io'), 'Tom Devlin');
});
