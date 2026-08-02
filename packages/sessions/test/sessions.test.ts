import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRunnable,
  governs,
  describeStarts,
  buildSystemPrompt,
  SessionHarness,
  buildSessionReceipt,
  ARRIVAL_SKILL,
  LIBRARIAN_AGENT,
  MEETING_PREP_AGENT,
  ASK_SKILL,
  WEEKLY_UPDATE_SKILL,
  CHAT_SKILL,
  SYNTHESIS_SKILL,
  VOICE_EXEC,
  FILING_RULES,
  DEFAULT_SKILL_BY_NAME,
  DEFAULT_SKILLS,
  DEFAULT_AGENTS,
  RETIRED_SKILL_FILES,
  buildSkillBrief,
  buildKickoff,
  parseKickoff,
} from '../src/index.js';

test('the instructions are the whole body, verbatim — nothing is dropped for lacking a heading', () => {
  const raw = `---\ntype: skill\nsummary: s\n---\nJust prose. No headings at all.\n\nA second paragraph.\n`;
  const c = parseRunnable(raw, 'plain');
  const p = buildSystemPrompt('PREAMBLE', c);
  assert.ok(p.startsWith('PREAMBLE'));
  assert.ok(p.includes('Just prose. No headings at all.'));
  assert.ok(p.includes('A second paragraph.'));
  // The regression this whole model exists to prevent: a file written as plain
  // prose used to reach the model as an empty prompt.
  assert.ok(!/^PREAMBLE\s*$/.test(p));
});

test('a file with headings keeps them — they are prose now, not a schema', () => {
  const c = parseRunnable(ARRIVAL_SKILL, 'arrival');
  const p = buildSystemPrompt('PRE', c);
  assert.ok(p.includes('## When'));
  assert.ok(p.includes('## Produce'));
  // And every word between them, in file order.
  assert.equal(p, `PRE\n\n${c.body.trim()}`);
});

test('starts: what puts a file in force, defaulting to reachable', () => {
  assert.deepEqual(parseRunnable(ASK_SKILL, 'ask').starts, ['you-run-it', 'model-picks-it-up']);
  assert.deepEqual(parseRunnable(VOICE_EXEC, 'voice-exec').starts, ['always']);
  assert.equal(parseRunnable(VOICE_EXEC, 'voice-exec').audience, 'executives');
  assert.deepEqual(parseRunnable(FILING_RULES, '_filing-rules').starts, ['always']);
  // A file that says nothing is one you can run — never silently unreachable.
  const bare = parseRunnable(`---\ntype: skill\nsummary: s\n---\nX.\n`, 't');
  assert.deepEqual(bare.starts, ['you-run-it', 'model-picks-it-up']);
  assert.deepEqual(bare.errors, []);
});

test('an unknown start is flagged and dropped, and the file stays reachable', () => {
  const junk = parseRunnable(`---\ntype: skill\nstarts: [whenever]\nsummary: s\n---\nX.\n`, 't');
  assert.ok(junk.errors.some((e) => /unknown starts "whenever"/.test(e)));
  assert.deepEqual(junk.starts, ['you-run-it', 'model-picks-it-up']);
});

test('governs: material is read, everything else takes over the session', () => {
  const ref = parseRunnable(`---\ntype: skill\nstarts: [read-when-relevant]\nsummary: s\n---\nX.\n`, 'g');
  assert.equal(governs(ref), false);
  assert.equal(describeStarts(ref), 'The agent reads it when it becomes relevant.');
  assert.equal(governs(parseRunnable(SYNTHESIS_SKILL, 'synthesis')), true);
  assert.equal(describeStarts(parseRunnable(VOICE_EXEC, 'voice-exec')), 'Always applied when drafting for executives.');
});

test('can: capabilities are a list, and the floor is empty', () => {
  assert.deepEqual(parseRunnable(ASK_SKILL, 'ask').can, []);
  assert.deepEqual(parseRunnable(WEEKLY_UPDATE_SKILL, 'weekly-update').can, ['draft-outbound']);
  assert.deepEqual(parseRunnable(SYNTHESIS_SKILL, 'synthesis').can, ['draft-outbound', 'keep-working-files']);
  const junk = parseRunnable(`---\ntype: skill\ncan: [rm-rf]\nsummary: s\n---\nX.\n`, 't');
  assert.deepEqual(junk.can, [], 'a typo must never read as a capability');
  assert.ok(junk.errors.some((e) => /unknown can "rm-rf"/.test(e)));
});

test('a file written before this vocabulary keeps working, and says what to change', () => {
  // A workspace is seeded once: old files sit on disk everywhere. Dropping
  // their config would quietly turn a house rule into a playbook nobody runs.
  const old = parseRunnable(
    `---\ntype: skill\nuse: always\naudience: executives\nsummary: s\n---\nX.\n`,
    'voice',
  );
  assert.deepEqual(old.starts, ['always'], 'still a house rule');
  assert.equal(old.audience, 'executives');
  assert.ok(old.errors.some((e) => /`use` moved/.test(e)));

  const ref = parseRunnable(`---\ntype: skill\nuse: reference\nsummary: s\n---\nX.\n`, 'g');
  assert.equal(governs(ref), false);

  const caps = parseRunnable(
    `---\ntype: skill\noutbound: true\nsession_files: true\nsummary: s\n---\nX.\n`,
    'w',
  );
  assert.deepEqual(caps.can, ['draft-outbound', 'keep-working-files'], 'permissions survive');
  assert.ok(caps.errors.some((e) => /`outbound: true` moved/.test(e)));

  // An explicit `starts` wins over a stale `use` — the new key is the answer.
  const both = parseRunnable(
    `---\ntype: skill\nuse: always\nstarts: [you-run-it]\nsummary: s\n---\nX.\n`,
    'b',
  );
  assert.deepEqual(both.starts, ['you-run-it']);
});

test('keys whose machinery is gone are flagged and honour nothing', () => {
  const raw = [
    '---',
    'type: skill',
    'summary: s',
    'use: playbook',
    'outbound: true',
    'session_files: true',
    'checkpoints: [a, b]',
    'gate_output: true',
    'completion_bar: every line cited',
    'red_flags:',
    '  - guessing',
    'stopping_conditions:',
    '  - nothing changed',
    'on:',
    '  - event: capture.transcript',
    'skill_kind: voice',
    'tier: suggest',
    'bindings:',
    '  - mode: forced',
    '---',
    'X.',
  ].join('\n');
  const c = parseRunnable(raw, 'legacy');
  for (const key of [
    'use', 'outbound', 'session_files', 'checkpoints', 'gate_output',
    'completion_bar', 'red_flags', 'stopping_conditions', 'on', 'skill_kind', 'tier', 'bindings',
  ]) {
    assert.ok(c.errors.some((e) => e.includes(key)), `${key} was not flagged`);
  }
});

test('audience only means something on an always-on rule', () => {
  const stray = parseRunnable(`---\ntype: skill\naudience: executives\nsummary: s\n---\nX.\n`, 't');
  assert.ok(stray.errors.some((e) => /audience/.test(e)));
});

test('title is the human name; the filename is only the fallback', () => {
  assert.equal(parseRunnable(SYNTHESIS_SKILL, 'synthesis').title, 'Find the pattern');
  // No title: the filename, made readable — never a path, even if the caller
  // hands over a vault slug (the picker used to render "skills/synthesis").
  const bare = `---\ntype: skill\nsummary: s\n---\nX.\n`;
  assert.equal(parseRunnable(bare, 'before-meeting').title, 'Before meeting');
  assert.equal(parseRunnable(bare, 'skills/before-meeting').title, 'Before meeting');
  for (const [name, skill] of Object.entries(DEFAULT_SKILL_BY_NAME)) {
    const { title } = parseRunnable(skill, name);
    assert.ok(title && !title.includes('/'), `${name} has no readable title`);
  }
});

test('a file is named by its file, not by its frontmatter', () => {
  const c = parseRunnable(`---\ntype: skill\nsummary: s\n---\nX.\n`, 'my-check');
  assert.equal(c.name, 'my-check');
  assert.deepEqual(c.errors, []);
});

test('enabled: false is the off switch; absent means on', () => {
  const off = parseRunnable(`---\ntype: agent\nsummary: s\nenabled: false\n---\nX.\n`, 'a');
  assert.equal(off.enabled, false);
  assert.equal(parseRunnable(LIBRARIAN_AGENT, 'librarian').enabled, true);
});

test('agents are parsed by the same door as skills, and declare no clock', () => {
  const lib = parseRunnable(LIBRARIAN_AGENT, 'librarian');
  assert.deepEqual(lib.errors, []);
  assert.ok(/repoint/i.test(lib.body));
  const prep = parseRunnable(MEETING_PREP_AGENT, 'meeting-prep');
  assert.deepEqual(prep.errors, []);
  assert.ok(/ledger is empty/i.test(prep.body));
  // The app holds the clock, so no shipped agent describes its own schedule —
  // a sentence here would be a second copy of what code already decides.
  for (const raw of [LIBRARIAN_AGENT, MEETING_PREP_AGENT]) {
    assert.doesNotMatch(raw, /every 5 minutes/i);
    assert.doesNotMatch(raw, /within the hour/i);
  }
});

test('no shipped default carries a frontmatter error, and every one has instructions', () => {
  // Both registries, because they overlap without either containing the other:
  // the always-on files ship without being invocable, so checking only the
  // by-name registry would let a broken house rule reach a workspace and
  // surface as a red flag on the Skills page instead of a red test.
  const shipped: [string, string][] = [
    ...Object.entries(DEFAULT_SKILL_BY_NAME),
    ...[...DEFAULT_SKILLS, ...DEFAULT_AGENTS].map(({ file, content }): [string, string] => [file, content]),
  ];
  for (const [name, raw] of shipped) {
    const c = parseRunnable(raw, name);
    assert.deepEqual(c.errors, [], `${name} has frontmatter errors: ${c.errors.join('; ')}`);
    assert.ok(c.body.trim().length > 0, `${name} has no instructions`);
  }
});

test('ask and chat dissolved into built-ins: resolvable by name, never shipped as files', () => {
  assert.ok(DEFAULT_SKILL_BY_NAME['ask']);
  assert.ok(DEFAULT_SKILL_BY_NAME['chat']);
  const files = [...DEFAULT_SKILLS, ...DEFAULT_AGENTS].map((s) => s.file);
  assert.ok(!files.some((f) => f.startsWith('skills/ask/')));
  assert.ok(!files.some((f) => f.startsWith('skills/chat/')));
  // Arrival ships as a skill again — the pipeline invokes it, no trigger needed.
  assert.ok(files.includes('skills/arrival/SKILL.md'));
  // The roster of self-starting agents: the librarian and meeting prep.
  assert.ok(files.includes('agents/librarian/AGENT.md'));
  assert.ok(files.includes('agents/meeting-prep/AGENT.md'));
  // Every shipped file is a folder entry: one layout, no exceptions.
  for (const f of files) assert.ok(/^(skills|agents)\/[^/]+\/(SKILL|AGENT)\.md$/.test(f), f);
  // Retired files are named in the layout they were shipped in; seeding removes
  // both forms (see ensureDefaultSkills), so what matters is that none is back.
  for (const gone of RETIRED_SKILL_FILES) {
    const folder = gone.replace(/\.md$/, '');
    assert.ok(!files.some((f) => f.startsWith(`${folder}/`)), `${gone} is still shipped`);
  }
});

test('old names still resolve: before-meeting is an alias for meeting-prep', () => {
  assert.equal(DEFAULT_SKILL_BY_NAME['before-meeting'], MEETING_PREP_AGENT);
});

test('receipt records reads, writes and turns', () => {
  const c = parseRunnable(ARRIVAL_SKILL, 'arrival');
  const h = new SessionHarness('abcd1234ef', c, '2026-07-15T09:00:00Z');
  h.beginTurn('Run After-Meeting on meetings/acme.md', '2026-07-15T09:00:00Z');
  h.recordRead('meetings/acme.md');
  h.recordRead('customers/acme-co.md');
  h.recordWrite('decisions/adopt-x.md', 'p_1', 'decision');
  const r = buildSessionReceipt(h, '2026-07-15T09:05:00Z');
  assert.ok(r.path.startsWith('sessions/2026-07-15-'));
  assert.equal(r.frontmatter.type, 'session');
  assert.equal(r.frontmatter.skill, 'arrival');
  assert.deepEqual(r.frontmatter.reads, ['[[meetings/acme]]', '[[customers/acme-co]]']);
  assert.deepEqual(r.frontmatter.writes, ['[[decisions/adopt-x]]']);
  assert.ok(r.body.includes('decision: [[decisions/adopt-x]] (p_1)'));
});

// --- Sessions v2 Part 3: skills arrive, they aren't a mode you're locked in ---

test('buildSkillBrief: a playbook arrives as rules in force, material as prose', () => {
  const brief = buildSkillBrief(parseRunnable(SYNTHESIS_SKILL, 'synthesis'));
  assert.match(brief, /Skill now in force: synthesis/);
  assert.match(brief, /govern the rest of this conversation/);
  assert.match(brief, /## Produce/);
  const ref = `---\ntype: skill\nstarts: [read-when-relevant]\nsummary: A checklist\n---\n\nCheck the thing.\n`;
  const g = buildSkillBrief(parseRunnable(ref, 'a-checklist'));
  assert.match(g, /## Reference: A checklist/);
  assert.match(g, /Check the thing\./);
  assert.doesNotMatch(g, /in force/);
});

test('an arriving skill brings its capabilities', () => {
  const chat = parseRunnable(CHAT_SKILL, 'chat');
  const h = new SessionHarness('s1', chat, '2026-07-28T09:00:00Z');
  assert.equal(h.outbound, false);

  h.invokeSkill(parseRunnable(SYNTHESIS_SKILL, 'synthesis'));
  assert.equal(h.outbound, true, 'arrival adds permissions');
  assert.equal(h.sessionFiles, true, 'and its working files');
  assert.equal(h.grants('draft-outbound'), true);
  assert.equal(h.activeSkillName, 'synthesis', 'cards are tagged with the skill that made them');
  assert.deepEqual(h.skillNames, ['chat', 'synthesis']);
});

test('the switch is a floor, so it is deliberately outside the composing OR', () => {
  const off = SYNTHESIS_SKILL.replace('type: skill', 'type: skill\nenabled: false');
  const cfg = parseRunnable(off, 'synthesis');
  assert.equal(cfg.enabled, false);
  // Still parsed in full. The floor is enforced before a session is fired
  // (runnableEnabled, @pm/application), never by quietly emptying `can`: a file
  // whose capabilities vanished when it was switched off would show the PM a
  // page claiming it does less than it does.
  assert.deepEqual(cfg.can, ['draft-outbound', 'keep-working-files']);
  // And the harness composes capabilities ONLY. Teaching grants() about the
  // switch would move a floor into the one path that widens, where the next
  // arrival's OR could climb back over it.
  const h = new SessionHarness('s4', parseRunnable(CHAT_SKILL, 'chat'), '2026-07-28T09:00:00Z');
  h.invokeSkill(cfg);
  assert.equal(h.grants('draft-outbound'), true);
});

test('a quieter arrival never strips permissions the session already had', () => {
  const weekly = parseRunnable(WEEKLY_UPDATE_SKILL, 'weekly-update');
  const h = new SessionHarness('s3', weekly, '2026-07-28T09:00:00Z');
  assert.equal(h.outbound, true);
  h.invokeSkill(parseRunnable(ASK_SKILL, 'ask'));
  assert.equal(h.outbound, true);
});

test('the receipt records every skill that was in force, not just the opener', () => {
  const h = new SessionHarness('abcd1234ef', parseRunnable(CHAT_SKILL, 'chat'), '2026-07-28T09:00:00Z');
  h.beginTurn('what do these nine interviews add up to?', '2026-07-28T09:00:00Z');
  h.invokeSkill(parseRunnable(SYNTHESIS_SKILL, 'synthesis'));
  const r = buildSessionReceipt(h, '2026-07-28T09:30:00Z');
  // The receipt is named for what the session was ABOUT — the first skill that
  // arrived — not the base every session opens with.
  assert.equal(r.frontmatter.skill, 'synthesis');
  assert.ok(r.path.includes('-synthesis-'));
  assert.deepEqual(r.frontmatter.skills, ['chat', 'synthesis']);
  assert.ok(r.body.includes('Skills: chat → synthesis'));
});

test('a skill invoked on a later turn does not rename an already-filed receipt', () => {
  const h = new SessionHarness('abcd1234ef', parseRunnable(CHAT_SKILL, 'chat'), '2026-07-28T09:00:00Z');
  h.beginTurn('what changed this week?', '2026-07-28T09:00:00Z');
  const first = buildSessionReceipt(h, '2026-07-28T09:05:00Z');
  assert.ok(first.path.includes('-chat-'));
  h.invokeSkill(parseRunnable(SYNTHESIS_SKILL, 'synthesis'));
  const later = buildSessionReceipt(h, '2026-07-28T09:40:00Z');
  assert.equal(later.path, first.path, 'a renamed receipt would orphan the one already on disk');
  assert.deepEqual(later.frontmatter.skills, ['chat', 'synthesis']);
});

test('a kickoff round-trips: the chat reads back the skill, the page, and the wording', () => {
  const prompt = buildKickoff({
    skill: 'arrival',
    target: 'sources/2026-07-30-meeting-with-xavier.md',
    instruction: 'read the capture, search the memory it might touch.',
  });
  assert.equal(
    prompt,
    'Run the arrival skill on sources/2026-07-30-meeting-with-xavier.md: read the capture, search the memory it might touch.',
  );
  assert.deepEqual(parseKickoff(prompt), {
    skill: 'arrival',
    target: 'sources/2026-07-30-meeting-with-xavier.md',
    instruction: 'read the capture, search the memory it might touch.',
  });
});

test('a kickoff without a page, and transcripts written before this contract', () => {
  assert.equal(buildKickoff({ skill: 'weekly-update', instruction: '' }), 'Run the weekly-update skill.');
  assert.deepEqual(parseKickoff('Run the weekly-update skill.'), {
    skill: 'weekly-update',
    instruction: '',
  });
  // "session" was the older word for the same thing — old conversations still say it.
  assert.deepEqual(parseKickoff('Run the before-meeting session on meetings/2026-07-30-nordkap.md: prep it.'), {
    skill: 'before-meeting',
    target: 'meetings/2026-07-30-nordkap.md',
    instruction: 'prep it.',
  });
});

test('a message the PM typed is never mistaken for a kickoff', () => {
  assert.equal(parseKickoff('what did we decide about pricing?'), null);
  assert.equal(parseKickoff('Run the numbers on decisions/adopt-workos.md before Friday'), null);
  assert.equal(parseKickoff('I just added these to the workspace:\n- sources/a.md'), null);
});
