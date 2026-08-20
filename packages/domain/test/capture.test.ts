import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyCapture } from '../src/index.js';

test('vtt/srt files and WEBVTT bodies are transcripts', () => {
  assert.equal(classifyCapture('anything', 'standup.vtt').kind, 'transcript');
  assert.equal(classifyCapture('anything', 'Nordkap QBR.srt').title, 'Nordkap QBR');
  const r = classifyCapture('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nhej');
  assert.equal(r.kind, 'transcript');
  assert.equal(r.confidence, 'high');
});

test('cue arrows alone mark a transcript', () => {
  const r = classifyCapture(
    '1\n00:00:01,000 --> 00:00:04,000\nhej\n2\n00:00:05,000 --> 00:00:08,000\nhej igen',
  );
  assert.equal(r.kind, 'transcript');
});

test('a bare URL is a link with the host as title', () => {
  const r = classifyCapture('https://www.example.com/articles/pricing-research');
  assert.equal(r.kind, 'link');
  assert.equal(r.confidence, 'high');
  assert.equal(r.url, 'https://www.example.com/articles/pricing-research');
  assert.equal(r.title, 'example.com');
});

test('a URL with a comment line uses the comment as title', () => {
  const r = classifyCapture('Bra artikel om SSO-prissättning\nhttps://example.com/sso');
  assert.equal(r.kind, 'link');
  assert.equal(r.title, 'Bra artikel om SSO-prissättning');
  assert.equal(r.url, 'https://example.com/sso');
});

test('repeated speaker turns read as a transcript', () => {
  const turns = Array.from({ length: 12 }, (_, i) =>
    i % 2
      ? `Anna: jag håller med, punkt ${i} behöver mer data från kunderna innan beslut.`
      : `Erik: vi borde titta på punkt ${i} igen, den känns inte klar för release ännu.`,
  ).join('\n');
  const r = classifyCapture(turns);
  assert.equal(r.kind, 'transcript');
  assert.equal(r.confidence, 'high');
});

test('short prose is a high-confidence note; huge prose is low', () => {
  const short = classifyCapture('Kranelund nämnde att de utvärderar en konkurrent.');
  assert.equal(short.kind, 'note');
  assert.equal(short.confidence, 'high');
  assert.equal(short.title, 'Kranelund nämnde att de utvärderar en konkurrent.');
  const long = classifyCapture('ord '.repeat(1000));
  assert.equal(long.kind, 'note');
  assert.equal(long.confidence, 'low');
});

test('markdown headers are stripped from the title guess', () => {
  assert.equal(classifyCapture('# Q3 priorities\n\ntext').title, 'Q3 priorities');
});

test('frontmatter-ish key: value lines do not read as speakers', () => {
  const md = ['status: draft', 'owner: erik', 'date: 2026-07-15'].join('\n');
  assert.equal(classifyCapture(md).kind, 'note');
});
