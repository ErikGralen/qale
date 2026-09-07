import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRunnable,
  buildSystemPrompt,
  SessionHarness,
  buildSessionReceipt,
  ARRIVAL_SKILL,
  LIBRARIAN_AGENT,
  MEETING_PREP_AGENT,
  ASK_SKILL,
  WEEKLY_UPDATE_SKILL,
  SYNTHESIS_SKILL,
  VOICE_EXEC,
  HOUSE_RULES,
  HOUSE_RULES_NAME,
  WANT_LIST_LINES,
  DEFAULT_SKILL_BY_NAME,
  DEFAULT_SKILLS,
  RETIRED_SKILLS,
  BASE_SKILL_NAME,
  isBaseSkillName,
  COMMITMENT_CHECK_SKILL,
  DEFAULT_AGENTS,
  DEFAULT_NOTES,
  DEFAULT_VOICES,
  newSkillFile,
  newVoiceFile,
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

test('what puts a file in force is not in the file', () => {
  // `starts` and `audience` are gone (SK-2). Where the file sits says it: a
  // skill is work you hand over, and a clock lives in code beside the sweep.
  const c = parseRunnable(ASK_SKILL, 'ask');
  assert.deepEqual(c.errors, []);
  assert.equal('starts' in c, false);
  assert.equal('audience' in c, false);
});

test('a retired key is an error on the file page, and honours nothing', () => {
  const old = parseRunnable(
    `---\ntype: skill\nstarts: [always]\naudience: executives\nsummary: s\n---\nX.\n`,
    'voice',
  );
  assert.ok(old.errors.some((e) => /`starts` is gone/.test(e)));
  assert.ok(old.errors.some((e) => /`audience` is gone/.test(e)));
  // The body is still the instructions: a bad key never costs a file its words.
  assert.equal(old.body.trim(), 'X.');
});

test('a key nothing reads is flagged, whatever it is', () => {
  const c = parseRunnable(`---\ntype: skill\nsummary: s\nmood: cheerful\n---\nX.\n`, 't');
  assert.ok(c.errors.some((e) => /`mood` is not a setting/.test(e)));
  // The four keys, plus `type` and the agents' switch, never flag.
  const clean = parseRunnable(
    `---\ntype: skill\ntitle: T\nsummary: s\nscenarios:\n  - one ("do the thing")\ncan: [draft-outbound]\nenabled: false\n---\nX.\n`,
    't',
  );
  assert.deepEqual(clean.errors, []);
});

test('can: capabilities are a list, and the floor is empty', () => {
  // A file that claims nothing gets nothing: reading and proposing cards is what
  // every session may do, and neither is a capability.
  assert.deepEqual(parseRunnable(COMMITMENT_CHECK_SKILL, 'commitment-check').can, []);
  // The base skill is the one built-in, and it carries the two the composer
  // needs: a session file to work in, and a draft to put in front of the PM.
  assert.deepEqual(parseRunnable(ASK_SKILL, 'ask').can, ['keep-working-files', 'draft-outbound']);
  assert.deepEqual(parseRunnable(WEEKLY_UPDATE_SKILL, 'weekly-update').can, ['draft-outbound']);
  assert.deepEqual(parseRunnable(SYNTHESIS_SKILL, 'synthesis').can, [
    'draft-outbound',
    'keep-working-files',
  ]);
  const junk = parseRunnable(`---\ntype: skill\ncan: [rm-rf]\nsummary: s\n---\nX.\n`, 't');
  assert.deepEqual(junk.can, [], 'a typo must never read as a capability');
  // Leads with the plain sentence, not the raw key, and "rm-rf" is nowhere
  // near a real capability, so every option is offered by its chip label.
  assert.ok(junk.errors.some((e) => /permission that does not exist: "rm-rf"/.test(e)));
  assert.ok(
    junk.errors.some(
      (e) => /Drafts calendar changes \(draft-calendar\)/.test(e) && /track-external/.test(e),
    ),
  );

  // A close typo gets one suggestion instead of the whole list, named in the
  // same plain words as the permission chip.
  const typo = parseRunnable(`---\ntype: skill\ncan: [draft-outbund]\nsummary: s\n---\nX.\n`, 't');
  assert.ok(
    typo.errors.some((e) =>
      /Did you mean "Drafts outgoing updates" \(can: \[draft-outbound\]\)/.test(e),
    ),
  );
});

/**
 * CM-4: a PM's own notes arrive through the received-sources door, so nothing
 * about the door says who wrote them. The skill sets `origin` to their own name,
 * which is what lets a citation say "your note from March" a year later.
 */
test('arrival marks the PM own writing as theirs', () => {
  const c = parseRunnable(ARRIVAL_SKILL, 'arrival');
  assert.match(c.body, /\*\*Their own writing\.\*\*/);
  assert.match(c.body, /your note from March/);
  // Still a source: their own writing does not get to walk into notes/.
  assert.match(c.body, /lands under `sources\/`, never in `notes\/`/);
});

test('the two files that need the narrow capabilities declare them', () => {
  // Only these two. A capability granted to a file that never uses it is the
  // thing this split was for.
  assert.deepEqual(parseRunnable(ARRIVAL_SKILL, 'arrival').can, [
    'file-source',
    'keep-working-files',
    'draft-outbound',
    'draft-calendar',
    'track-external',
  ]);
  assert.deepEqual(parseRunnable(LIBRARIAN_AGENT, 'librarian').can, [
    'draft-outbound',
    'track-external',
  ]);
  for (const raw of [WEEKLY_UPDATE_SKILL, SYNTHESIS_SKILL, ASK_SKILL]) {
    const cfg = parseRunnable(raw, 'x');
    assert.ok(!cfg.can.includes('draft-calendar'), `${cfg.title} does not book meetings`);
    assert.ok(!cfg.can.includes('track-external'), `${cfg.title} does not change what syncs`);
  }
  // And every default file parses clean, which is what makes the check below a
  // signal rather than noise everybody learns to skip.
  for (const [name, raw] of Object.entries(DEFAULT_SKILL_BY_NAME)) {
    assert.deepEqual(parseRunnable(raw, name).errors, [], `${name} has a frontmatter problem`);
  }
});

test('a capability that got narrower says so, where the file is read', () => {
  // The case readList cannot catch: `draft-outbound` is still a real capability,
  // so the file parses clean and quietly loses the three calendar tools.
  const old = parseRunnable(
    `---\ntype: skill\nsummary: s\ncan: [draft-outbound]\n---\nBook the follow-up with draft_calendar_event.\n`,
    'old-skill',
  );
  assert.deepEqual(old.can, ['draft-outbound'], 'the capability it does have is untouched');
  assert.ok(
    old.errors.some(
      (e) =>
        /draft_calendar_event/.test(e) &&
        /"Drafts calendar changes" permission \(can: \[draft-calendar\]\)/.test(e),
    ),
    `expected a narrowing hint, got ${JSON.stringify(old.errors)}`,
  );

  const tracking = parseRunnable(
    `---\ntype: agent\nsummary: s\n---\nAsk, then record it with follow_container.\n`,
    'old-agent',
  );
  assert.ok(
    tracking.errors.some(
      (e) =>
        /follow_container/.test(e) &&
        /"Watches your tracker and wiki" permission \(can: \[track-external\]\)/.test(e),
    ),
  );

  // Silent once the file says what it needs, and silent for a file that never
  // mentions the tools at all.
  const fixed = parseRunnable(
    `---\ntype: skill\nsummary: s\ncan: [draft-outbound, draft-calendar]\n---\nBook it with draft_calendar_event.\n`,
    'new-skill',
  );
  assert.deepEqual(fixed.errors, []);
  assert.deepEqual(parseRunnable(WEEKLY_UPDATE_SKILL, 'weekly-update').errors, []);
});

test('the keys that moved are gone, and say what to write instead', () => {
  const caps = parseRunnable(
    `---\ntype: skill\noutbound: true\nsession_files: true\nsummary: s\n---\nX.\n`,
    'w',
  );
  // Nothing is honoured any more: a file says what it may do, or it may not.
  assert.deepEqual(caps.can, []);
  // Leads with the plain chip label, then names the key that replaces the setting.
  assert.ok(
    caps.errors.some(
      (e) => /`outbound: true` is gone/.test(e) && /"Drafts outgoing updates"/.test(e),
    ),
  );
  assert.ok(
    caps.errors.some(
      (e) => /`session_files: true` is gone/.test(e) && /"Keeps working files"/.test(e),
    ),
  );
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
    'use',
    'outbound',
    'session_files',
    'checkpoints',
    'gate_output',
    'completion_bar',
    'red_flags',
    'stopping_conditions',
    'on',
    'skill_kind',
    'tier',
    'bindings',
  ]) {
    assert.ok(
      c.errors.some((e) => e.includes(key)),
      `${key} was not flagged`,
    );
  }
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
  // the house rules ship without being invocable, so checking only the by-name
  // registry would let a broken one reach a workspace and surface as a red flag
  // on the Skills page instead of a red test. The voices go through the same
  // parser, so they are held to the same bar.
  const shipped: [string, string][] = [
    ...Object.entries(DEFAULT_SKILL_BY_NAME),
    ...[...DEFAULT_SKILLS, ...DEFAULT_AGENTS, ...DEFAULT_VOICES].map(
      ({ file, content }): [string, string] => [file, content],
    ),
  ];
  for (const [name, raw] of shipped) {
    const c = parseRunnable(raw, name);
    assert.deepEqual(c.errors, [], `${name} has frontmatter errors: ${c.errors.join('; ')}`);
    assert.ok(c.body.trim().length > 0, `${name} has no instructions`);
  }
});

test('the house rules are one file, and Your rules is its last heading', () => {
  const c = parseRunnable(HOUSE_RULES, HOUSE_RULES_NAME);
  assert.deepEqual(c.errors, []);
  assert.equal(c.title, 'House rules');
  // The sections the merged always-on files became, plus the two that took the
  // rules the individual skills each used to restate. One document, so the model
  // reads one set of rules instead of the same rule in six bodies.
  for (const heading of [
    '## Language',
    '## Reading the memory',
    '## Writing',
    '## Proposing',
    '## Filing',
    '## Your rules',
  ]) {
    assert.ok(c.body.includes(heading), `the house rules have no ${heading} section`);
  }
  // Last on purpose: `propose_instruction` appends a bullet to the end of the
  // file, and that only lands under Your rules while nothing follows it.
  const headings = c.body.split('\n').filter((line) => /^#{1,6}\s/.test(line));
  assert.equal(headings.at(-1), '## Your rules');
  // It ships as a file, so a fresh workspace has it to edit.
  assert.ok(DEFAULT_SKILLS.some((s) => s.file === 'skills/house-rules/SKILL.md'));
});

/**
 * The file Qale reads before it writes into a skill or a voice
 * (docs/learning-how-you-work.md, ticket 17). It is a rules file like the house
 * rules: no scenarios, no capabilities, nothing to run. It ships so the PM can
 * edit it, and it has to parse clean or the Skills page flags a file we wrote.
 */
test('the writing-skills skill ships, parses clean, and is a rules file', () => {
  const seed = DEFAULT_SKILLS.find((s) => s.file === 'skills/writing-skills/SKILL.md');
  assert.ok(seed, 'skills/writing-skills/SKILL.md is not in DEFAULT_SKILLS');
  const c = parseRunnable(seed.content, 'writing-skills');
  assert.deepEqual(c.errors, [], c.errors.join('; '));
  assert.equal(c.title, 'How Qale writes skills');
  assert.deepEqual(c.scenarios, [], 'a rules file is not work anyone picks up');
  assert.deepEqual(c.can, [], 'a rules file performs nothing');
  for (const heading of [
    '## What goes where',
    '## The sections of a skill',
    '## The first line',
    '## Size',
  ]) {
    assert.ok(c.body.includes(heading), `writing-skills has no ${heading} section`);
  }
  // Resolvable by name too, so a workspace that lost the file still has it.
  assert.equal(DEFAULT_SKILL_BY_NAME['writing-skills'], seed.content);
});

test('the always-on files it replaced are gone from the pack', () => {
  const files = DEFAULT_SKILLS.map((s) => s.file);
  for (const name of ['_language', '_writing', '_filing-rules', '_your-rules']) {
    assert.ok(!files.includes(`skills/${name}/SKILL.md`), `${name} still ships`);
  }
});

/**
 * SK-4 and SK-5: the pack ships no underscore file at all. The unattended rules
 * are code in the agent preamble, and the product picture is written by the
 * interview into `research/`. Both left because neither was work anyone hands
 * over, which is the only thing a skill is.
 */
test('nothing underscore-prefixed ships any more', () => {
  const files = [...DEFAULT_SKILLS, ...DEFAULT_AGENTS].map((s) => s.file);
  for (const f of files) {
    assert.ok(!/\/_/.test(f), `${f} is still an underscore file`);
  }
  assert.ok(!files.includes('skills/_unattended/SKILL.md'));
  assert.ok(!files.includes('skills/_understanding/SKILL.md'));
});

/**
 * MT-3 (docs/memory-types.md): the product picture is three research pages the
 * interview writes, and nothing seeds a stub or an orientation note for them.
 * A page that does not exist yet is an honest gap; a seeded placeholder would
 * be a page in Memory saying nothing.
 */
test('the product picture is written by the interview, never seeded', () => {
  assert.ok(!DEFAULT_NOTES.some((n) => n.file.startsWith('understanding/')));
  assert.ok(!DEFAULT_NOTES.some((n) => n.file.startsWith('research/')));
  assert.ok(!DEFAULT_SKILLS.some((s) => s.file.includes('_understanding')));
});

test('scenarios: a list when the file writes one, empty when it does not', () => {
  const c = parseRunnable(
    `---\ntype: skill\nsummary: s\nscenarios:\n  - chasing a promise ("this one is overdue")\n  - closing one out ("can I close this")\n---\nX.\n`,
    't',
  );
  assert.deepEqual(c.scenarios, [
    'chasing a promise ("this one is overdue")',
    'closing one out ("can I close this")',
  ]);
  assert.deepEqual(c.errors, [], 'prose has nothing to validate against');
  // Absent is the common case and is not a problem: a house rule has nothing to
  // trigger, and neither does a file the PM only ever runs by name.
  const none = parseRunnable(`---\ntype: skill\nsummary: s\n---\nX.\n`, 't');
  assert.deepEqual(none.scenarios, []);
  assert.deepEqual(none.errors, []);
  assert.deepEqual(parseRunnable(VOICE_EXEC, 'exec').scenarios, []);
});

/**
 * The lint the whole `scenarios` change exists for. `use_skill` routes on this
 * text, so a shipped skill the model may pick up and that carries no scenarios
 * is reachable in theory and unreachable in practice: the session works freehand
 * and nothing fails, which is why an unchecked rule does not hold.
 */
test('every shipped skill the model may pick up says when to pick it up', () => {
  // Every skill is pickable now, so the exceptions are named rather than read
  // off a key: the house rules are already in the prompt, and writing-skills is
  // a rules file the model reads before it writes a rule, not work it picks up.
  // The voices are not in this list at all any more; they live in `voices/`
  // (SK-6), where nobody picks them up as work.
  const exempt = ['house-rules', 'writing-skills'];
  const pickable = DEFAULT_SKILLS.filter(
    ({ file }) => !exempt.some((name) => file === `skills/${name}/SKILL.md`),
  );
  // A filter that matched nothing would pass the loop below in silence.
  assert.ok(pickable.length >= 6, `only ${pickable.length} shipped skills are pickable`);
  for (const { file, content } of pickable) {
    const c = parseRunnable(content, file);
    assert.ok(c.scenarios.length > 0, `${file} carries no scenarios`);
  }
});

test('a brand new skill parses clean, and teaches no settings', () => {
  const c = parseRunnable(newSkillFile('Chase renewals'), 'chase-renewals');
  // A red flag on a file the PM created ten seconds ago would be a bad first
  // minute, and the flag would be ours, not theirs.
  assert.deepEqual(c.errors, []);
  assert.equal(c.title, 'Chase renewals');
  // Nothing left to configure, so the template teaches no key.
  assert.ok(!/starts:|audience:/.test(c.body), 'the template names a key that is gone');
  // A title with YAML punctuation in it must survive rather than break the file.
  const odd = parseRunnable(newSkillFile('Renewals: "the hard ones"'), 'renewals');
  assert.deepEqual(odd.errors, []);
  assert.equal(odd.title, 'Renewals: "the hard ones"');
});

test('a brand new voice parses clean, and says a voice is tone only', () => {
  const c = parseRunnable(newVoiceFile('Board'), 'board');
  assert.deepEqual(c.errors, []);
  assert.equal(c.title, 'Board');
  // A voice must never steer what a draft says, and the file the PM starts
  // from is the only place that rule can be stated before they write.
  assert.match(c.body, /never decides what a draft says/);
  // No key to teach, same as the skill template.
  assert.ok(!/starts:|audience:/.test(c.body), 'the template names a key that is gone');
  const odd = parseRunnable(newVoiceFile('Sales: "the short one"'), 'sales');
  assert.deepEqual(odd.errors, []);
  assert.equal(odd.title, 'Sales: "the short one"');
});

test('ask dissolved into a built-in: resolvable by name, never shipped as a file', () => {
  assert.ok(DEFAULT_SKILL_BY_NAME['ask']);
  // One default now. `chat` was the second one and resolves to the same text.
  assert.equal(DEFAULT_SKILL_BY_NAME['chat'], ASK_SKILL);
  assert.equal(BASE_SKILL_NAME, 'ask');
  assert.ok(isBaseSkillName('chat'), 'the old name must not arrive as a second skill');
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
});

test('old names still resolve: an alias points at whatever does the work now', () => {
  assert.equal(DEFAULT_SKILL_BY_NAME['before-meeting'], MEETING_PREP_AGENT);
  // incoming-request folded into commitment-check, so a stored receipt naming
  // it opens the merged skill instead of nothing.
  assert.equal(DEFAULT_SKILL_BY_NAME['incoming-request'], COMMITMENT_CHECK_SKILL);
  assert.ok(!DEFAULT_SKILLS.some((s) => s.file.startsWith('skills/incoming-request/')));
  assert.deepEqual(RETIRED_SKILLS, ['skills/incoming-request/SKILL.md']);
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

/**
 * A run reads the orientation maps, and those are deliberately never indexed, so
 * `[[notes/index]]` is a link that can never resolve. Writing it anyway put four
 * or five permanently broken links into the workspace per session, and the
 * librarian found every one of them, every week, with no repair that would have
 * worked.
 */
test('receipt does not link what nothing can link', () => {
  const c = parseRunnable(ARRIVAL_SKILL, 'arrival');
  const h = new SessionHarness('abcd1234ef', c, '2026-07-15T09:00:00Z');
  h.beginTurn('Run the arrival skill.', '2026-07-15T09:00:00Z');
  h.recordRead('notes/index.md');
  h.recordRead('sessions/.files/abcd1234ef/input.md');
  h.recordRead('meetings/acme.md');
  const r = buildSessionReceipt(h, '2026-07-15T09:05:00Z');

  // The frontmatter half is an edge list, so only the real page is in it.
  assert.deepEqual(r.frontmatter.reads, ['[[meetings/acme]]']);
  // The body still says everything the run read, links where a link works.
  assert.ok(r.body.includes('- `notes/index`'), r.body);
  assert.ok(r.body.includes('- `sessions/.files/abcd1234ef/input`'), r.body);
  assert.ok(r.body.includes('- [[meetings/acme]]'), r.body);
});

// --- Sessions v2 Part 3: skills arrive, they aren't a mode you're locked in ---

test('buildSkillBrief: every skill arrives as rules in force', () => {
  const brief = buildSkillBrief(parseRunnable(SYNTHESIS_SKILL, 'synthesis'));
  assert.match(brief, /Skill now in force: synthesis/);
  assert.match(brief, /govern the rest of this conversation/);
  assert.match(brief, /## Produce/);
  // Reference material died with `starts` (SK-2): a file the model reads
  // without following it is a note, and notes live in the memory.
  const plain = `---\ntype: skill\nsummary: A checklist\n---\n\nCheck the thing.\n`;
  const g = buildSkillBrief(parseRunnable(plain, 'a-checklist'));
  assert.match(g, /Skill now in force: a-checklist/);
  assert.match(g, /Check the thing\./);
});

test('an arriving skill brings its capabilities', () => {
  const base = parseRunnable(ASK_SKILL, 'ask');
  const h = new SessionHarness('s1', base, '2026-07-28T09:00:00Z');
  assert.equal(h.outbound, true, 'an open session can already draft a message');
  assert.equal(h.draftCalendar, false);

  h.invokeSkill(parseRunnable(ARRIVAL_SKILL, 'arrival'));
  assert.equal(h.outbound, true, 'arrival keeps permissions the session already had');
  assert.equal(h.draftCalendar, true, 'and adds its own, new ones');
  assert.equal(h.sessionFiles, true, 'and its working files');
  assert.equal(h.grants('draft-outbound'), true);
  assert.equal(h.activeSkillName, 'arrival', 'cards are tagged with the skill that made them');
  assert.deepEqual(h.skillNames, ['ask', 'arrival']);
});

test('the switch is a floor, so it is deliberately outside the composing OR', () => {
  const off = SYNTHESIS_SKILL.replace('type: skill', 'type: skill\nenabled: false');
  const cfg = parseRunnable(off, 'synthesis');
  assert.equal(cfg.enabled, false);
  // Still parsed in full. The floor is enforced before a session is fired
  // (runnableEnabled, @qale/application), never by quietly emptying `can`: a file
  // whose capabilities vanished when it was switched off would show the PM a
  // page claiming it does less than it does.
  assert.deepEqual(cfg.can, ['draft-outbound', 'keep-working-files']);
  // And the harness composes capabilities ONLY. Teaching grants() about the
  // switch would move a floor into the one path that widens, where the next
  // arrival's OR could climb back over it.
  const h = new SessionHarness('s4', parseRunnable(ASK_SKILL, 'ask'), '2026-07-28T09:00:00Z');
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
  const h = new SessionHarness(
    'abcd1234ef',
    parseRunnable(ASK_SKILL, 'ask'),
    '2026-07-28T09:00:00Z',
  );
  h.beginTurn('what do these nine interviews add up to?', '2026-07-28T09:00:00Z');
  h.invokeSkill(parseRunnable(SYNTHESIS_SKILL, 'synthesis'));
  const r = buildSessionReceipt(h, '2026-07-28T09:30:00Z');
  // The receipt is named for what the session was ABOUT — the first skill that
  // arrived — not the base every session opens with.
  assert.equal(r.frontmatter.skill, 'synthesis');
  assert.ok(r.path.includes('-synthesis-'));
  assert.deepEqual(r.frontmatter.skills, ['ask', 'synthesis']);
  // The frontmatter keeps the invocation names (addresses); the body, which a
  // person reads, prints the titles.
  assert.ok(r.body.includes('Skills: Ask the memory → Find the pattern'));
  assert.equal(r.frontmatter.title, 'Find the pattern session');
});

test('a skill invoked on a later turn does not rename an already-filed receipt', () => {
  const h = new SessionHarness(
    'abcd1234ef',
    parseRunnable(ASK_SKILL, 'ask'),
    '2026-07-28T09:00:00Z',
  );
  h.beginTurn('what changed this week?', '2026-07-28T09:00:00Z');
  const first = buildSessionReceipt(h, '2026-07-28T09:05:00Z');
  assert.ok(first.path.includes('-ask-'));
  h.invokeSkill(parseRunnable(SYNTHESIS_SKILL, 'synthesis'));
  const later = buildSessionReceipt(h, '2026-07-28T09:40:00Z');
  assert.equal(later.path, first.path, 'a renamed receipt would orphan the one already on disk');
  assert.deepEqual(later.frontmatter.skills, ['ask', 'synthesis']);
});

test('a kickoff round-trips: the chat reads back the skill, the page, and the wording', () => {
  const prompt = buildKickoff({
    skill: 'arrival',
    targets: ['sources/2026-07-30-meeting-with-xavier.md'],
    instruction: 'read the capture, search the memory it might touch.',
  });
  assert.equal(
    prompt,
    'Run the arrival skill on sources/2026-07-30-meeting-with-xavier.md: read the capture, search the memory it might touch.',
  );
  assert.deepEqual(parseKickoff(prompt), {
    skill: 'arrival',
    targets: ['sources/2026-07-30-meeting-with-xavier.md'],
    instruction: 'read the capture, search the memory it might touch.',
  });
});

test('a kickoff over several pages names every one of them', () => {
  const prompt = buildKickoff({
    skill: 'arrival',
    targets: ['meetings/2026-08-04-qbr.md', 'sources/2026-08-04-deck.md'],
    instruction: 'read both.',
  });
  assert.equal(
    prompt,
    'Run the arrival skill on meetings/2026-08-04-qbr.md, sources/2026-08-04-deck.md: read both.',
  );
  assert.deepEqual(parseKickoff(prompt), {
    skill: 'arrival',
    targets: ['meetings/2026-08-04-qbr.md', 'sources/2026-08-04-deck.md'],
    instruction: 'read both.',
  });
});

test('a kickoff without a page, and transcripts written before this contract', () => {
  assert.equal(
    buildKickoff({ skill: 'weekly-update', instruction: '' }),
    'Run the weekly-update skill.',
  );
  assert.deepEqual(parseKickoff('Run the weekly-update skill.'), {
    skill: 'weekly-update',
    instruction: '',
  });
  // "session" was the older word for the same thing — old conversations still say it.
  assert.deepEqual(
    parseKickoff('Run the before-meeting session on meetings/2026-07-30-nordkap.md: prep it.'),
    {
      skill: 'before-meeting',
      targets: ['meetings/2026-07-30-nordkap.md'],
      instruction: 'prep it.',
    },
  );
});

test('a message the PM typed is never mistaken for a kickoff', () => {
  assert.equal(parseKickoff('what did we decide about pricing?'), null);
  assert.equal(parseKickoff('Run the numbers on decisions/adopt-workos.md before Friday'), null);
  assert.equal(parseKickoff('I just added these to the workspace:\n- sources/a.md'), null);
});

/**
 * SK-6: the voices ship into their own folder, and carry tone only. The last
 * assertion is the one with teeth: a voice that told a draft what to include
 * would quietly overrule the skill that asked for it, which is exactly the
 * audience concept this replaced.
 */
test('the voices ship in voices/, as flat files, with nothing but tone in them', () => {
  assert.deepEqual(
    DEFAULT_VOICES.map((v) => v.file),
    ['voices/exec.md', 'voices/cs.md', 'voices/sales.md'],
  );
  // Not a skill, and not in the by-name registry: nothing invokes a voice.
  const skillFiles = DEFAULT_SKILLS.map((s) => s.file);
  for (const v of DEFAULT_VOICES) assert.ok(!skillFiles.includes(v.file));
  assert.ok(!('exec' in DEFAULT_SKILL_BY_NAME));
  assert.ok(!('cs' in DEFAULT_SKILL_BY_NAME));

  for (const { file, content } of DEFAULT_VOICES) {
    const c = parseRunnable(content, file);
    assert.deepEqual(c.errors, [], `${file}: ${c.errors.join('; ')}`);
    assert.deepEqual(c.can, [], 'a voice performs nothing');
    assert.deepEqual(c.scenarios, [], 'nothing reaches for a voice');
    assert.ok(c.summary.length > 0);
    // Frontmatter is title and summary (plus the note type). A retired key here
    // would flag on the file's own page, which is not what a shipped file does.
    const fm = content.split('---')[1] ?? '';
    assert.deepEqual(
      fm
        .trim()
        .split('\n')
        .map((line) => line.split(':')[0]),
      ['type', 'title', 'summary'],
      `${file} carries a key a voice has no use for`,
    );
  }
});

/**
 * SK-10: the weekly update names its audiences and drafts one panel each. The
 * confidentiality lines are the round-5 KISS call (R5-3): they used to sit in an
 * audience-scoped voice, and a voice carries tone only now, so the skill that
 * drafts to customers carries them.
 */
test('the weekly update lists its voices, and holds the CS draft to what it may not say', () => {
  const c = parseRunnable(WEEKLY_UPDATE_SKILL, 'weekly-update');
  assert.deepEqual(c.errors, []);
  // Both shipped voices are named, and the list says it is a list to add to.
  assert.match(c.body, /\*\*exec\*\*/);
  assert.match(c.body, /\*\*cs\*\*/);
  assert.match(c.body, /Add a voice here/);
  // One panel per voice, with a variant per take, rather than one call per take.
  assert.match(c.body, /One `draft_text` call per voice/);
  assert.ok(c.body.includes('**Full**') && c.body.includes('**Short**'));
  // The guardrails the voices no longer carry.
  assert.ok(c.body.includes('## Never in the CS draft'), 'the confidentiality section is gone');
  for (const rule of ['No internal metrics', 'No other customer', 'No internal shorthand']) {
    assert.ok(c.body.includes(rule), `the CS draft is not held to "${rule}"`);
  }
  // The output shape stays the last thing in the body: the preamble reads a
  // trailing fenced block as the shape of the drafts.
  assert.ok(c.body.trimEnd().endsWith('```'));
});

/**
 * CV-2 (docs/conventions.md): the two skills that draft for a connected system
 * name the conventions file at the step where they draft. The tool descriptions
 * say it too, but a session reads its skill first, and these are the two paths
 * most drafts come out of.
 *
 * A pointer, never a gate. Neither file is seeded, so both lines say "when the
 * workspace has one" and a missing file costs nothing.
 */
test('the drafting skills point at the conventions file, and do not require it', () => {
  const meeting = parseRunnable(ARRIVAL_SKILL, 'arrival');
  assert.deepEqual(meeting.errors, []);
  assert.ok(meeting.body.includes('`skills/jira/SKILL.md`'));
  assert.match(meeting.body, /when the workspace\n?\s*has one/);

  const weekly = parseRunnable(WEEKLY_UPDATE_SKILL, 'weekly-update');
  assert.ok(weekly.body.includes('`skills/confluence/SKILL.md`'));
  assert.match(weekly.body, /when the workspace has one/);
});

/**
 * SK-11: one interview skill, any topic. The address matters as much as the
 * title — `interview` was the obvious slug and the wrong one, because a
 * workspace full of customer interviews would send everyone holding transcripts
 * to it instead of to `synthesis`.
 */
test('the interview takes a topic, and ships under a name that is not the product', () => {
  const seed = DEFAULT_SKILLS.find((s) => s.file === 'skills/tell-qale/SKILL.md');
  assert.ok(seed, 'the interview does not ship');
  assert.equal(DEFAULT_SKILL_BY_NAME['tell-qale'], seed.content);
  // The old name is gone from both registries. Nothing aliases it: the file a
  // workspace already has keeps working under its own folder name.
  assert.ok(!('learn-the-product' in DEFAULT_SKILL_BY_NAME));
  assert.ok(!DEFAULT_SKILLS.some((s) => s.file.includes('learn-the-product')));

  const c = parseRunnable(seed.content, 'tell-qale');
  assert.deepEqual(c.errors, []);
  assert.equal(c.title, 'Tell Qale about something');
  // Three scenarios, and not one of them is about the product: the product is an
  // example inside the body, not what the skill is for.
  assert.equal(c.scenarios.length, 3);
  assert.ok(c.scenarios.some((s) => /pricing/.test(s)));
  assert.ok(c.scenarios.some((s) => /onboarding/.test(s)));
  assert.ok(c.scenarios.some((s) => /team/.test(s)));
  // A topic comes in with the request, and the product is one of them.
  assert.match(c.body, /## Example topic: the product/);
  // What it learns lands in the memory, on the three about pages in `about/`
  // (docs/learning-how-you-work.md, ticket 16). Nothing points at the two
  // folders they used to live in.
  for (const area of ['product', 'technical', 'organization']) {
    assert.ok(c.body.includes(`about/${area}.md`), `${area} is not a landing place`);
  }
  assert.ok(!c.body.includes('understanding/'));
  assert.ok(!c.body.includes('research/product.md'));
  // CM-4: the interview asks for the notes they already wrote, and says the word
  // folder, because nobody drops one unless told they can.
  assert.match(c.body, /Do you keep notes from before\? Drop the folder/);
});

/**
 * The first look (docs/first-look-debrief.md): the second way the interview
 * starts. The app fires it unattended when a connection finishes reading a site
 * for the first time, and the kickoff points at one section by name, so that
 * heading is a contract between the code and the copy.
 */
test('the interview knows how to open on what a connection just read', () => {
  const seed = DEFAULT_SKILLS.find((s) => s.file === 'skills/tell-qale/SKILL.md');
  assert.ok(seed);
  const c = parseRunnable(seed.content, 'tell-qale');
  assert.deepEqual(c.errors, []);

  // The heading the kickoff names. Rename it and the unattended run is handed a
  // pointer to nothing.
  assert.match(c.body, /^## First look$/m);
  // Two beats, and the first one ends the turn: nothing is written before they
  // have said they want it.
  assert.match(c.body, /Write nothing, propose nothing/);
  // Hypothesis first, which is the rule that supersedes "sources are the
  // check, not the author" (docs/product-understanding.md U-2).
  assert.ok(c.body.includes('hypothesis first'));
  // The calendar is a source too (CM-5). The trigger arms on any connection, so
  // a copy that speaks only of epics and tickets leaves a calendar debrief with
  // nothing to say.
  assert.ok(c.body.includes('The calendar and the meetings already filed'));
  assert.match(c.body, /Where two sources agree, say so/);
  // The knock now fires for a workspace that has already been told about the
  // product too (2026-08-31). The kickoff says so, and this branch is the only
  // thing that stops it interviewing them a second time.
  assert.match(c.body, /When the kickoff says the picture is already there/);
  assert.match(c.body, /Do not run the interview/);
  // How they write is written down when the connection is made, from their own
  // tickets and pages (docs/learning-how-you-work.md, tickets 3 and 4). The old
  // beat three asked about it one rule at a time; it is cut, and the file has to
  // say so or the model asks anyway. One question per system is the ceiling,
  // and an example is never asked for.
  assert.ok(!c.body.includes('Beat three'), 'the conventions beat is cut (E-25)');
  assert.match(c.body, /Never ask how they use Jira or Confluence one rule at a\s+time/);
  assert.match(c.body, /at most one question per system/);
  assert.match(c.body, /never ask them to paste an example/);
  assert.match(c.body, /Open the debrief with the\s+link to that file/);
  assert.ok(
    c.body.includes('which they confirmed, lands verified'),
    'the confirmed-hypothesis marking rule is gone',
  );

  // The seeds: one card, and the two things it may set up.
  assert.ok(c.body.includes('`track_external`'), 'tracked tickets go through the existing tool');
  assert.ok(c.body.includes('`propose_note`'), 'a research page is still a proposal');
  assert.match(c.body, /Never mirror a wiki page/);
  // Tracking writes sync state, so the file has to claim it by name.
  assert.deepEqual(c.can, ['track-external']);
});

/**
 * The "What you want from Qale" list (docs/learning-how-you-work.md ticket 8).
 * The section is built from `WANT_LIST_LINES`, so the file and the ids the
 * telemetry reports cannot drift. It sits right before Your rules, which stays
 * last: `propose_instruction` appends rules to the end of the file and edits
 * this section in place.
 */
test('the house rules carry the "What you want from Qale" list, built from its lines', () => {
  const c = parseRunnable(HOUSE_RULES, HOUSE_RULES_NAME);
  const headings = c.body.split('\n').filter((line) => /^#{1,6}\s/.test(line));
  assert.equal(headings.at(-2), '## What you want from Qale');
  assert.equal(headings.at(-1), '## Your rules');

  const section = c.body.split('## What you want from Qale')[1]!.split('## Your rules')[0]!;
  assert.match(section, /Qale reads this before every job/);
  assert.match(section, /Keep it to about ten lines\./);
  const bullets = section
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2));
  assert.deepEqual(
    bullets,
    WANT_LIST_LINES.map((line) => line.text),
  );

  // Six lines, one per pain point, each with a stable tag-shaped id.
  assert.equal(WANT_LIST_LINES.length, 6);
  const ids = WANT_LIST_LINES.map((line) => line.id);
  assert.deepEqual([...new Set(ids)], ids);
  for (const id of ids) assert.match(id, /^[a-z][a-z0-9-]*$/);
  assert.ok(ids.includes('who-is-waiting'));
});

/**
 * The voices ship with no pick yet (docs/learning-how-you-work.md, ticket 10).
 * The first weekly update reads the file to know that: a first line that says
 * so, and three `###` styles under it. A voice that lost one of the two would
 * skip the three-style panel, and the PM would never be asked.
 */
test('each voice ships with the no-pick line and three named styles', () => {
  for (const { file, content } of DEFAULT_VOICES) {
    const body = content.split('---').slice(2).join('---');
    const lines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    // The title, then the first line the file says about itself.
    assert.match(lines[0] ?? '', /^# /, `${file} does not open with its title`);
    assert.match(
      lines[1] ?? '',
      /^I do not know how you want .* updates to read yet\. Until you pick, the first update comes in these three styles:$/,
      `${file} does not open with the no-pick line`,
    );
    const styles = lines.filter((l) => l.startsWith('### '));
    assert.equal(styles.length, 3, `${file} lists ${styles.length} styles, not three`);
    assert.ok(lines.includes('## How it sounds'), `${file} lost its tone section`);
    assert.ok(
      body.includes('delete two styles and keep one'),
      `${file} does not say the PM can pick by editing the file`,
    );
  }
});
