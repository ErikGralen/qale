import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  checkFrontmatterMutation,
  layerForType,
  isBodyEditable,
  dirForType,
  zOutboundPayload,
  type Frontmatter,
} from '../src/index.js';

/**
 * Area A contract tests: the provider-generic external-mirror note types
 * (`ticket` / `wikipage`) and the genericized outbound payload, including the
 * legacy-compat transform for pre-genericization proposal rows.
 */

const TICKET = {
  type: 'ticket',
  summary: 'SAML SSO epic — blocked on infra review',
  provider: 'jira',
  external_id: 'PAY-142',
  container: 'PAY',
  state: 'Väntar på granskning',
  state_category: 'blocked',
  assignee: 'Mika',
  remote_updated: '2026-07-21T14:03:00Z',
  url: 'https://tavla.atlassian.net/browse/PAY-142',
};

const WIKIPAGE = {
  type: 'wikipage',
  summary: 'Enterprise Onboarding — spec page',
  provider: 'confluence',
  external_id: '98342',
  container: 'Product',
  version: 17,
  remote_updated: '2026-07-18T09:12:00Z',
  url: 'https://tavla.atlassian.net/wiki/spaces/PROD/pages/98342',
};

test('ticket: round-trips through parseFrontmatter, defaults processing new, preserves unknown keys', () => {
  const r = parseFrontmatter({ ...TICKET, custom_x: 42 });
  assert.equal(r.ok, true, r.error);
  const fm = r.data as Record<string, unknown>;
  assert.equal(fm['processing'], 'new'); // fresh mirror → analyses know to run
  assert.equal(fm['state_category'], 'blocked');
  assert.equal(fm['state'], 'Väntar på granskning'); // raw label survives verbatim
  assert.equal(fm['custom_x'], 42); // OKF-tolerant

  // Round-trip: re-parsing the parsed result is a fixpoint.
  const again = parseFrontmatter(r.data);
  assert.equal(again.ok, true);
  assert.deepEqual(again.data, r.data);
});

test('ticket: state_category is a closed enum — raw workflow words are rejected there', () => {
  const bad = parseFrontmatter({ ...TICKET, state_category: 'In Review' });
  assert.equal(bad.ok, false); // logic must never branch on provider labels
});

test('ticket: provider is a closed enum, required identity fields enforced', () => {
  assert.equal(parseFrontmatter({ ...TICKET, provider: 'trello' }).ok, false);
  const missingId: Record<string, unknown> = { ...TICKET };
  delete missingId['external_id'];
  assert.equal(parseFrontmatter(missingId).ok, false);
});

test('wikipage: round-trips with version + remote_updated', () => {
  const r = parseFrontmatter(WIKIPAGE);
  assert.equal(r.ok, true, r.error);
  const fm = r.data as Record<string, unknown>;
  assert.equal(fm['processing'], 'new');
  assert.equal(fm['version'], 17);

  const again = parseFrontmatter(r.data);
  assert.equal(again.ok, true);
  assert.deepEqual(again.data, r.data);
});

test('mirrors are raw layer: body immutable, only re-sync fields may change', () => {
  assert.equal(layerForType('ticket'), 'raw');
  assert.equal(layerForType('wikipage'), 'raw');
  assert.equal(isBodyEditable('ticket'), false);
  assert.equal(isBodyEditable('wikipage'), false);
  assert.equal(dirForType('ticket'), 'tickets');
  assert.equal(dirForType('wikipage'), 'wikipages');

  const prev = parseFrontmatter(TICKET).data as Frontmatter;
  // A re-sync refresh (state moved, processing reset) is allowed…
  const resync = {
    ...prev,
    state: 'Klar',
    state_category: 'done',
    remote_updated: '2026-07-22T08:00:00Z',
    processing: 'new',
  } as Frontmatter;
  assert.equal(checkFrontmatterMutation('ticket', prev, resync).allowed, true);
  // …but identity never changes: a moved item is a new mirror.
  const retarget = { ...prev, external_id: 'PAY-999' } as Frontmatter;
  assert.equal(checkFrontmatterMutation('ticket', prev, retarget).allowed, false);
});

// ---------------------------------------------------------------------------
// Outbound payload: generic vocabulary + legacy-compat transform
// ---------------------------------------------------------------------------

test('outbound: legacy persisted records normalize to provider + generic actions', () => {
  const cases: [Record<string, unknown>, { provider: string; action: string }][] = [
    [
      { system: 'jira', action: 'create_issue', projectKey: 'PAY' },
      { provider: 'jira', action: 'create_ticket' },
    ],
    [
      { system: 'jira', action: 'add_comment', issueKey: 'PAY-142' },
      { provider: 'jira', action: 'comment_ticket' },
    ],
    [
      { system: 'confluence', action: 'update_page', pageId: '98342' },
      { provider: 'confluence', action: 'update_page' },
    ],
    [
      { system: 'message', action: 'message', audience: 'cs' },
      { provider: 'message', action: 'send_message' },
    ],
  ];
  for (const [legacy, want] of cases) {
    const r = zOutboundPayload.safeParse({ ...legacy, body: 'b', rationale: 'r' });
    if (!r.success) assert.fail(`legacy payload rejected: ${JSON.stringify(legacy)}`);
    assert.equal(r.data.provider, want.provider);
    assert.equal(r.data.action, want.action);
    // The deprecated mirror stays populated so old payload readers still resolve.
    assert.equal(r.data.system, want.provider);
  }
});

test('outbound: new-shape payloads parse and are a fixpoint of the transform', () => {
  const fresh = {
    provider: 'jira',
    action: 'comment_ticket',
    issueKey: 'PAY-142',
    body: 'Nordkap confirms go-live Jul 28.',
    linkBackPath: 'meetings/2026-07-14-nordkap-checkin.md',
    rationale: 'agreed in the check-in',
  };
  const once = zOutboundPayload.parse(fresh);
  assert.equal(once.system, 'jira'); // mirror filled in
  const twice = zOutboundPayload.parse(once);
  assert.deepEqual(twice, once);
});

test('outbound: unknown actions and providers are rejected, not passed through', () => {
  assert.equal(
    zOutboundPayload.safeParse({
      provider: 'jira',
      action: 'transition_issue',
      body: 'b',
      rationale: 'r',
    }).success,
    false,
  );
  assert.equal(
    zOutboundPayload.safeParse({
      provider: 'linear',
      action: 'create_ticket',
      body: 'b',
      rationale: 'r',
    }).success,
    false,
  );
  // Missing provider entirely (malformed row) fails loudly.
  assert.equal(
    zOutboundPayload.safeParse({ action: 'create_ticket', body: 'b', rationale: 'r' }).success,
    false,
  );
});
