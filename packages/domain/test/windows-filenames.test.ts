import assert from 'node:assert/strict';
import test from 'node:test';
import { fileSlug, slugify, windowsSafeName } from '../src/notes/slug.js';

/**
 * The names Windows refuses. Tested as pure functions with Windows-shaped input
 * rather than by faking a platform, because the rules apply on every platform:
 * a vault written on a Mac has to open on a PC, so the name is decided once,
 * here, and not per machine.
 */

test('a reserved DOS device name is escaped, whatever its case or extension', () => {
  for (const name of ['con', 'CON', 'Con', 'prn', 'aux', 'nul', 'com1', 'COM9', 'lpt1', 'LPT9']) {
    assert.notEqual(windowsSafeName(name), name, `${name} is unusable as a filename on Windows`);
  }
  assert.equal(windowsSafeName('con'), 'con_');
  assert.equal(windowsSafeName('CON.md'), 'CON_.md', 'an extension does not make it legal');
  assert.equal(windowsSafeName('com3.md'), 'com3_.md');
});

test('names that merely look like devices are left exactly as they are', () => {
  for (const name of [
    'console',
    'con-call',
    'aux-notes',
    'com0', // only COM1 through COM9 are devices
    'com10',
    'lpt0',
    'nullable',
    'my-con',
    '2026-08-12-con', // a date prefix already makes it a name and not a device
  ]) {
    assert.equal(windowsSafeName(name), name, name);
  }
});

test('escaping is idempotent, so a slug still matches the path it minted', () => {
  // Load-bearing: the wikipage sync matcher and link repair compare a freshly
  // slugified title against a path segment written earlier the same way. A
  // transform that moved on every pass would stop those two lining up.
  assert.equal(windowsSafeName(windowsSafeName('con')), windowsSafeName('con'));
  assert.equal(slugify(slugify('CON')), slugify('CON'));
});

test('trailing dots and spaces are removed, because Windows removes them silently', () => {
  // The failure this prevents: the file we asked for and the file on disk get
  // different names, so the index keys a row nothing resolves to and the note is
  // invisible in the app while sitting in the folder.
  assert.equal(windowsSafeName('summary.'), 'summary');
  assert.equal(windowsSafeName('summary...'), 'summary');
  assert.equal(windowsSafeName('summary '), 'summary');
  assert.equal(windowsSafeName('summary. . '), 'summary');
  assert.equal(windowsSafeName('sum.mary.md'), 'sum.mary.md', 'an inner dot is a normal character');
});

test('slugify mints a name Windows accepts', () => {
  assert.equal(slugify('CON'), 'con_');
  assert.equal(slugify('Aux'), 'aux_');
  assert.equal(slugify('LPT1'), 'lpt1_');
  // Everything else comes out exactly as it did before the rule existed.
  assert.equal(slugify('Gong SSO blocker'), 'gong-sso-blocker');
  assert.equal(slugify('Möte med Åsa'), 'mote-med-asa');
  assert.equal(slugify('control panel'), 'control-panel');
});

test('a date-prefixed filename is never escaped, on any platform', () => {
  // fileSlug is built on the raw kebab on purpose: the date makes a device name
  // impossible, so applying the guard again could only mangle names that were
  // never in danger.
  assert.equal(fileSlug('CON', '2026-08-12'), '2026-08-12-con');
  assert.equal(fileSlug('Weekly sync', '2026-08-12'), '2026-08-12-weekly-sync');
  assert.equal(fileSlug('', '2026-08-12'), '2026-08-12-note');
});
