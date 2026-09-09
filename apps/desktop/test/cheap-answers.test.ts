import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHILD_PREAMBLE,
  FOLDER_PURPOSE_SYSTEM_PROMPT,
  MATCH_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  cleanTitle,
  matchPrompt,
  namingSystemPrompt,
  namingUserPrompt,
  parseVerdict,
  summaryPrompt,
  type Candidate,
} from '@qale/agent';
import { acceptLabels, acceptPurpose } from '@qale/application';
import {
  NEW_CLAIM,
  cheapAnswer,
  cheapKind,
  type CheapContext,
} from '../src/main/demo/cheap-answers.js';

/**
 * The rule answers for the four single-turn calls (docs/plan-demo-replay.md,
 * section 4.4). Each answer is pushed through the parser the product reads it
 * with, so a shape the parser refuses fails here and not on demo day.
 */

const CANDIDATES: Candidate[] = [
  {
    path: 'decisions/2026-05-18-h2-order-payroll-first.md',
    type: 'decision',
    excerpt: 'Åsa picked payroll export for Q3 and shift swaps for Q4.',
  },
];

function context(over: Partial<CheapContext> = {}): CheapContext {
  return {
    lookups: {
      claims: {
        'Åsa reverses H2 order':
          'CONFLICT | decisions/2026-05-18-h2-order-payroll-first.md | Åsa picked payroll export for Q3 and shift swaps for Q4.',
      },
      summaries: {
        'sources/2026-09-09-steering-transcript.md':
          'Steering call where Åsa moved shift swaps ahead of payroll export.',
        'documents/steering': 'Steering decks and the notes taken under them.',
      },
    },
    titleFor: () => undefined,
    ...over,
  };
}

test('the system prompt says which job it is, and a session is none of them', () => {
  assert.equal(cheapKind(namingSystemPrompt()), 'naming');
  assert.equal(cheapKind(namingSystemPrompt('sv')), 'naming');
  assert.equal(cheapKind(MATCH_SYSTEM_PROMPT), 'claim');
  assert.equal(cheapKind(summaryPrompt({ path: 'a.md', title: 'A', body: 'x' }).system), 'summary');
  assert.equal(
    cheapKind(summaryPrompt({ path: 'a.md', title: 'A', body: 'x', wantsTags: true }).system),
    'summary',
  );
  assert.equal(cheapKind(FOLDER_PURPOSE_SYSTEM_PROMPT), 'folder');
  assert.equal(cheapKind(CHILD_PREAMBLE), null);
  assert.equal(cheapKind('You are the embedded agent inside "Qale".'), null);
  assert.equal(cheapKind(''), null);
});

test('a claim with an entry gets its line, and the parser reads the verdict', () => {
  const user = matchPrompt(
    {
      claim: 'Åsa reverses H2 order: shift swaps ship first, payroll export moves to Q1.',
      about: [],
    } as never,
    CANDIDATES,
  );
  const line = cheapAnswer('claim', user, context());
  const verdict = parseVerdict(line, CANDIDATES);
  assert.equal(verdict.verdict, 'conflict');
  assert.equal(verdict.path, 'decisions/2026-05-18-h2-order-payroll-first.md');
  assert.match(verdict.evidence, /payroll export for Q3/);
});

test('a claim nobody scripted is NEW, which files quietly', () => {
  const user = matchPrompt({ claim: 'Offline mode remains declined.', about: [] } as never, CANDIDATES);
  const line = cheapAnswer('claim', user, context());
  assert.equal(line, NEW_CLAIM);
  assert.deepEqual(parseVerdict(line, CANDIDATES), { verdict: 'new', path: null, evidence: '' });
});

test('the naming call gets the bound title, else the first six words', () => {
  const typed = 'SCH-231 is done. Who needs to know, and what do I tell them?';
  const bound = context({ titleFor: (m) => (m === typed ? 'Who to tell about SCH-231' : undefined) });
  const user = namingUserPrompt({ prompt: typed });
  assert.equal(cleanTitle(cheapAnswer('naming', user, bound)), 'Who to tell about SCH-231');
  assert.equal(
    cleanTitle(cheapAnswer('naming', user, context())),
    'SCH-231 is done. Who needs to',
  );
  // A kickoff names no first message. The page it ran on is the name, else the skill.
  const onPage = namingUserPrompt({
    skill: 'Handle a commitment',
    targets: ['Reply to Marcus about the swap ETA'],
  });
  assert.equal(cleanTitle(cheapAnswer('naming', onPage, bound)), 'Reply to Marcus about the swap ETA');
  const bare = namingUserPrompt({ skill: 'Write the weekly update' });
  assert.equal(cleanTitle(cheapAnswer('naming', bare, bound)), 'Write the weekly update');
});

test('a summary with an entry gets it, else the first sentence, and the pass accepts both', () => {
  const scripted = summaryPrompt({
    path: 'sources/2026-09-09-steering-transcript.md',
    title: 'Steering transcript',
    body: 'Åsa: let us talk about H2.\n\nMarcus: fine.',
    wantsTags: true,
    tagsInUse: ['shift-swaps'],
  });
  const withTags = cheapAnswer('summary', scripted.user, context());
  assert.deepEqual(acceptLabels(withTags, ['shift-swaps']), {
    summary: 'Steering call where Åsa moved shift swaps ahead of payroll export.',
    tags: [],
    answered: true,
  });

  const unscripted = summaryPrompt({
    path: 'customers/fjord-sports.md',
    title: 'Fjord Sports',
    body:
      '# Fjord Sports\n\nA **retail** chain that is planning a Visma migration around [[tickets/jira/SCH-118|payroll export]]. Oskar runs it.\n\nMore below.',
  });
  const plain = cheapAnswer('summary', unscripted.user, context());
  assert.equal(
    plain,
    'A retail chain that is planning a Visma migration around payroll export.',
  );
  assert.deepEqual(acceptLabels(plain), { summary: plain, tags: [], answered: true });

  // A first sentence longer than the pass accepts is cut at a word.
  const long = summaryPrompt({
    path: 'notes/long.md',
    title: 'Long',
    body: `${'word '.repeat(60)}end.`,
  });
  const cutLine = cheapAnswer('summary', long.user, context());
  assert.ok(cutLine.length <= 160, cutLine);
  assert.ok(cutLine.endsWith('…'));
  assert.equal(acceptLabels(cutLine).answered, true);
});

test('a folder purpose with an entry gets it, else a line the folder map can hold', () => {
  const scripted = summaryPrompt({
    kind: 'folder',
    path: 'documents/steering',
    title: 'Steering',
    body: 'Deck one: the H2 order.\nDeck two: the Q3 plan.',
  });
  assert.equal(
    acceptPurpose(cheapAnswer('folder', scripted.user, context())),
    'Steering decks and the notes taken under them.',
  );
  const unscripted = summaryPrompt({
    kind: 'folder',
    path: 'documents/contracts',
    title: 'Contracts',
    body: 'MSA: the master agreement.',
  });
  const line = cheapAnswer('folder', unscripted.user, context());
  assert.equal(acceptPurpose(line), 'The documents kept under Contracts.');
});
