import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContradictionPrompt,
  parseContradictionVerdict,
  resolveVerdict,
  type ContradictionInput,
} from '../src/index.js';

/**
 * Judgment fixtures: decision + page text + a model reply → expected verdict
 * routing. The LLM reply is canned, so these pin the DETERMINISTIC half of the
 * judgment — parsing, the confidence gate, passage localization, grounding —
 * and give prompt iteration a harness that never touches sync or UI code.
 * Fixtures cover: clear contradiction, subtle, none, superseded chain,
 * diffuse/unlocalizable, and an ungrounded rewrite (→ Unverified).
 */

const SCIM_DECISION: ContradictionInput['decision'] = {
  title: 'Defer SCIM to Q3',
  date: '2026-04-15',
  summary: 'Ship SSO first, defer SCIM to Q3',
  body:
    'One auth migration at a time: SSO unblocks security reviews (pass/fail), SCIM removes ongoing\n' +
    'pain (severe but survivable). SSO ships first; SCIM scoping starts August, delivery September.',
};

const ONBOARDING_PAGE_CLEAR = {
  title: 'Enterprise Onboarding',
  body: [
    '## Provisioning',
    '',
    'Enterprise tenants authenticate via SAML SSO (WorkOS). Group and role assignment is manual during onboarding.',
    '',
    'SCIM provisioning ships in Q2 alongside the SSO rollout, so group mapping is automatic from day one.',
    '',
    '## Rollout checklist',
    '',
    '- IdP metadata exchanged and verified in staging',
  ].join('\n'),
};

const verdictJson = (v: Record<string, unknown>): string => JSON.stringify(v);

test('fixture: clear contradiction — high confidence + verbatim passage → prepared fix', () => {
  const raw = verdictJson({
    contradicts: true,
    confidence: 'high',
    passage: 'SCIM provisioning ships in Q2 alongside the SSO rollout, so group mapping is automatic from day one.',
    replacement: 'SCIM provisioning is deferred to Q3 (delivery September); group mapping stays manual after SSO go-live.',
    grounded: true,
    explanation: 'The page promises SCIM in Q2; the decision defers it to Q3.',
  });
  const verdict = parseContradictionVerdict(raw)!;
  const resolution = resolveVerdict(verdict, ONBOARDING_PAGE_CLEAR.body);
  assert.equal(resolution.kind, 'fix');
  if (resolution.kind !== 'fix') return;
  assert.equal(resolution.inference, false);
  assert.match(resolution.body, /deferred to Q3/);
  assert.doesNotMatch(resolution.body, /ships in Q2/);
  // Everything around the passage is untouched.
  assert.match(resolution.body, /## Rollout checklist/);
});

test('fixture: subtle contradiction — medium confidence → judgment-call ping, never a guessed edit', () => {
  const raw = verdictJson({
    contradicts: true,
    confidence: 'medium',
    passage: 'Group and role assignment is manual during onboarding.',
    replacement: 'Group and role assignment is manual until SCIM lands in Q3.',
    grounded: true,
    explanation: 'The page implies manual assignment is temporary pre-Q2; the decision moved that to Q3.',
  });
  const resolution = resolveVerdict(parseContradictionVerdict(raw)!, ONBOARDING_PAGE_CLEAR.body);
  assert.equal(resolution.kind, 'ping');
});

test('fixture: no contradiction — page merely omits the decision → nothing', () => {
  const raw = verdictJson({
    contradicts: false,
    confidence: 'high',
    passage: null,
    replacement: null,
    grounded: true,
    explanation: 'The page does not mention SCIM timing at all.',
  });
  const resolution = resolveVerdict(parseContradictionVerdict(raw)!, 'A page about something else.');
  assert.equal(resolution.kind, 'none');
});

test('fixture: superseded chain — page still matches the OLD decision → fix against the current one', () => {
  const input: ContradictionInput = {
    decision: {
      title: 'Adopt WorkOS',
      date: '2026-05-20',
      summary: 'Adopt WorkOS for SSO/SCIM instead of building on Firebase Auth',
      body: 'WorkOS replaces the Firebase Auth plan for enterprise SSO and SCIM.',
    },
    chain: [
      {
        title: 'Use Firebase Auth',
        summary: 'Build enterprise auth on Firebase Auth',
        status: 'superseded',
        date: '2026-02-10',
      },
    ],
    page: {
      title: 'Enterprise Onboarding',
      body: 'Enterprise authentication is built on Firebase Auth; IdP federation arrives later.',
    },
  };
  // The chain rides into the prompt so the model can see what "old truth" looks like.
  const { system, prompt } = buildContradictionPrompt(input);
  assert.match(prompt, /Earlier decisions this one replaced/);
  assert.match(prompt, /\[superseded, 2026-02-10\] Use Firebase Auth/);
  assert.match(system, /still matches an OLD,?\s+superseded decision/);

  const raw = verdictJson({
    contradicts: true,
    confidence: 'high',
    passage: 'Enterprise authentication is built on Firebase Auth; IdP federation arrives later.',
    replacement: 'Enterprise authentication is built on WorkOS for SSO and SCIM.',
    grounded: true,
    explanation: 'The page still describes the superseded Firebase Auth plan; the current decision is WorkOS.',
  });
  const resolution = resolveVerdict(parseContradictionVerdict(raw)!, input.page.body);
  assert.equal(resolution.kind, 'fix');
});

test('fixture: diffuse contradiction — no localizable passage → ping', () => {
  const raw = verdictJson({
    contradicts: true,
    confidence: 'high',
    passage: null,
    replacement: null,
    grounded: true,
    explanation: 'The whole page assumes automatic provisioning from day one.',
  });
  const resolution = resolveVerdict(parseContradictionVerdict(raw)!, ONBOARDING_PAGE_CLEAR.body);
  assert.equal(resolution.kind, 'ping');
});

test('fixture: hallucinated passage — verbatim anchor missing from the page → ping, never a blind edit', () => {
  const raw = verdictJson({
    contradicts: true,
    confidence: 'high',
    passage: 'SCIM support arrives with the Q2 platform release.',
    replacement: 'SCIM support arrives in Q3.',
    grounded: true,
    explanation: 'The page cites the wrong quarter.',
  });
  const resolution = resolveVerdict(parseContradictionVerdict(raw)!, ONBOARDING_PAGE_CLEAR.body);
  assert.equal(resolution.kind, 'ping');
});

test('fixture: ungrounded rewrite — fix survives but is flagged inference (Unverified)', () => {
  const raw = verdictJson({
    contradicts: true,
    confidence: 'high',
    passage: 'SCIM provisioning ships in Q2 alongside the SSO rollout, so group mapping is automatic from day one.',
    replacement: 'SCIM provisioning ships in Q3; contact the platform team for interim group-mapping scripts.',
    grounded: false,
    explanation: 'The decision says Q3, but the interim-scripts detail is not in the decision.',
  });
  const resolution = resolveVerdict(parseContradictionVerdict(raw)!, ONBOARDING_PAGE_CLEAR.body);
  assert.equal(resolution.kind, 'fix');
  if (resolution.kind === 'fix') assert.equal(resolution.inference, true);
});

test('parse: tolerates fences and prose; rejects garbage and no-op rewrites', () => {
  const fenced = '```json\n{"contradicts": true, "confidence": "low", "passage": null, "replacement": null, "grounded": true, "explanation": "x"}\n```';
  assert.equal(parseContradictionVerdict(fenced)?.confidence, 'low');

  assert.equal(parseContradictionVerdict('The page looks fine to me.'), null);
  assert.equal(parseContradictionVerdict('{"contradicts": "yes"}'), null);
  assert.equal(parseContradictionVerdict('{"contradicts": true, "confidence": "sure"}'), null);

  // passage === replacement is a no-op; the gate refuses to file it as a fix.
  const noop = verdictJson({
    contradicts: true,
    confidence: 'high',
    passage: 'Group and role assignment is manual during onboarding.',
    replacement: 'Group and role assignment is manual during onboarding.',
    grounded: true,
    explanation: 'x',
  });
  assert.equal(resolveVerdict(parseContradictionVerdict(noop)!, ONBOARDING_PAGE_CLEAR.body).kind, 'ping');
});

test('prompt: carries the decision, its date, and the page text verbatim', () => {
  const { prompt } = buildContradictionPrompt({
    decision: SCIM_DECISION,
    chain: [],
    page: ONBOARDING_PAGE_CLEAR,
  });
  assert.match(prompt, /## Current decision: Defer SCIM to Q3/);
  assert.match(prompt, /Decided: 2026-04-15/);
  assert.match(prompt, /delivery September/);
  assert.match(prompt, /## Page: Enterprise Onboarding/);
  assert.match(prompt, /ships in Q2 alongside the SSO rollout/);
  assert.doesNotMatch(prompt, /Earlier decisions/);
});
