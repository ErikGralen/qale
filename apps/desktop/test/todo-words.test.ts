import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitTodoWords } from '../src/renderer/src/lib/todo-words.js';

test('a leading quote splits into the words, the citation and the rest', () => {
  const body = [
    '> "I\'ll file the export gap today and point it at these notes."',
    '> from [[meetings/2026-07-10-internal-auth-review]]',
    '',
    'Filed as ENG-241.',
  ].join('\n');
  assert.deepEqual(splitTodoWords(body), {
    quote: "I'll file the export gap today and point it at these notes.",
    cite: '[[meetings/2026-07-10-internal-auth-review]]',
    rest: 'Filed as ENG-241.',
  });
});

test('curly quotes are stripped too, and a lone mark stays', () => {
  assert.equal(splitTodoWords('> “Give me two weeks.”').quote, 'Give me two weeks.');
  assert.equal(splitTodoWords('> "Give me two weeks.').quote, '"Give me two weeks.');
});

test('a quote with no from line keeps every line and cites nothing', () => {
  const words = splitTodoWords('> First line.\n> Second line.\n\nAfter.');
  assert.equal(words.quote, 'First line.\nSecond line.');
  assert.equal(words.cite, null);
  assert.equal(words.rest, 'After.');
});

test('a body without a quote is all rest', () => {
  assert.deepEqual(splitTodoWords('Just a note.\n'), {
    quote: null,
    cite: null,
    rest: 'Just a note.',
  });
  assert.deepEqual(splitTodoWords(''), { quote: null, cite: null, rest: '' });
});

test('a quote that is only a from line has no words', () => {
  const words = splitTodoWords('> from [[meetings/x]]\n\nRest.');
  assert.equal(words.quote, null);
  assert.equal(words.cite, '[[meetings/x]]');
  assert.equal(words.rest, 'Rest.');
});

test('a body that starts with a blank line still splits', () => {
  const words = splitTodoWords('\n> "Said."\n> from [[meetings/x]]\n\nRest.\n');
  assert.equal(words.quote, 'Said.');
  assert.equal(words.cite, '[[meetings/x]]');
  assert.equal(words.rest, 'Rest.');
});
