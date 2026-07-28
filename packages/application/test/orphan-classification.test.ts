import assert from 'node:assert/strict';
import test from 'node:test';
import type { PingOrphanItem, PingRecord } from '../src/ports.js';
import { runLibrarianSweep, resolvePingItem } from '../src/use-cases/pings.js';
import { getMaintenanceReport } from '../src/use-cases/vault.js';
import { fakeDriftWorld, inote } from './drift-helpers.js';

/**
 * "Has no links" is a symptom with several causes, and the sweep must answer
 * each on its own terms: an open Jira mirror is unconnected (never deletable
 * here), a closed one is history (not a finding at all), a scratch pad naming
 * pages it never links is capture waiting to be processed, and only a
 * workspace-owned page nothing cites is the hygiene case that may offer Delete.
 */

function ticket(id: string, state: string, category: string) {
  return inote({
    path: `tickets/${id}.md`,
    type: 'ticket',
    title: `${id} · Webhook delivery retries with backoff`,
    frontmatter: {
      provider: 'jira',
      external_id: id,
      container: 'PAY',
      state,
      state_category: category,
    },
  });
}

/** A vault with one of each cause, plus hubs for the capture note to name. */
function world(search = false) {
  const notes = [
    ticket('PAY-5', 'In Progress', 'in_progress'),
    ticket('PAY-6', 'To Do', 'open'),
    ticket('PAY-4', 'Done', 'done'),
    inote({ path: 'notes/friday-scratch.md', type: 'note', title: 'Friday Scratch' }),
    inote({ path: 'notes/leftover.md', type: 'note', title: 'Leftover Page' }),
    // Linked hubs, so none counts as an orphan — and all named by the scratch
    // pad, in the shortened form real prose actually uses.
    inote({
      path: 'customers/kranelund-logistics.md',
      type: 'customer',
      title: 'Kranelund Logistics',
      links: ['themes/scheduled-reporting'],
    }),
    inote({
      path: 'people/sara-lindqvist.md',
      type: 'person',
      title: 'Sara Lindqvist',
      links: ['themes/scheduled-reporting'],
    }),
    inote({
      path: 'themes/scheduled-reporting.md',
      type: 'theme',
      title: 'Scheduled Reporting',
      links: ['customers/kranelund-logistics'],
    }),
  ];
  return fakeDriftWorld({
    notes,
    bodies: {
      'tickets/PAY-5.md': 'Retry failed webhook deliveries with exponential backoff.',
      'tickets/PAY-6.md': 'Reconciliation report date-range filter.',
      'tickets/PAY-4.md': 'Payout report exports for finance teams.',
      // Nobody writing at speed types "Kranelund Logistics" or "Sara Lindqvist";
      // and "scheduled" alone must NOT be read as naming Scheduled Reporting.
      'notes/friday-scratch.md':
        'sara called re sso rollout, wants a runbook\nkranelund: lise is STILL screenshotting the monday report\nsomeone asked about scheduled exports again',
      'notes/leftover.md': 'a stub nobody ever came back to',
      'customers/kranelund-logistics.md': 'See [[themes/scheduled-reporting]].',
      'people/sara-lindqvist.md': 'See [[themes/scheduled-reporting]].',
      'themes/scheduled-reporting.md': 'See [[customers/kranelund-logistics]].',
    },
    completions: null,
    search,
  });
}

const orphanItems = (ping: PingRecord): PingOrphanItem[] =>
  (ping.payload as { kind: 'orphans'; items: PingOrphanItem[] }).items;

test('a mirror the upstream system already closed is not a maintenance finding', () => {
  const { ctx } = world();
  const paths = getMaintenanceReport(ctx).orphans.map((o) => o.path);
  assert.ok(paths.includes('tickets/PAY-5.md'), 'an open unconnected ticket is still a finding');
  assert.ok(!paths.includes('tickets/PAY-4.md'), 'a closed ticket nobody cited is history, not work');
});

test('a calendar-mirrored meeting is never reported as unlinked', () => {
  const { ctx } = fakeDriftWorld({
    notes: [
      inote({
        path: 'meetings/2026-08-19-nordkap-check-in.md',
        type: 'meeting',
        title: 'Nordkap check-in',
        frontmatter: { provider: 'google-calendar', external_id: 'evt-1' },
      }),
    ],
    bodies: { 'meetings/2026-08-19-nordkap-check-in.md': '' },
    completions: null,
  });
  // An upcoming meeting nobody has written about yet is the normal state of the
  // world; nagging about it would bury the findings that are real work.
  assert.deepEqual(getMaintenanceReport(ctx).orphans, []);
});

test('mirrors carry their key as a search alias and their upstream state', () => {
  const { ctx } = world();
  const pay5 = getMaintenanceReport(ctx).orphans.find((o) => o.path === 'tickets/PAY-5.md')!;
  assert.equal(pay5.external, true);
  assert.equal(pay5.detail, 'In Progress');
  // Prose cites "PAY-5", never the composed title — hunting only the title finds nothing.
  assert.ok(pay5.aliases.includes('PAY-5'));
  assert.ok(pay5.aliases.includes('Webhook delivery retries with backoff'));
});

test('a workspace-owned page carries no external identity', () => {
  const { ctx } = world();
  const leftover = getMaintenanceReport(ctx).orphans.find((o) => o.path === 'notes/leftover.md')!;
  assert.equal(leftover.external, false);
  assert.deepEqual(leftover.aliases, []);
  assert.equal(leftover.detail, null);
});

test('the sweep splits one symptom into findings by cause', async () => {
  const w = world();
  await runLibrarianSweep(w.ctx);
  const keys = w.pings.map((p) => p.key);

  // Two open mirrors clear the floor; the single capture note clears its own.
  assert.ok(keys.includes('unconnected-mirrors'));
  assert.ok(keys.includes('unprocessed-captures'));
  // One stray is below the hygiene floor of three — not worth a card.
  assert.ok(!keys.includes('stray-notes'));
  // The old undifferentiated key must not come back: it would offer Delete on
  // everything, which is exactly what the split exists to prevent.
  assert.ok(!keys.includes('orphan-connect'));

  const mirrors = w.pings.find((p) => p.key === 'unconnected-mirrors')!;
  assert.match(mirrors.title, /^2 open tickets aren't linked from anywhere in the workspace$/);
  assert.deepEqual(
    orphanItems(mirrors).map((i) => i.path).sort(),
    ['tickets/PAY-5.md', 'tickets/PAY-6.md'],
  );
  assert.ok(orphanItems(mirrors).every((i) => i.kind === 'external'));
});

test('a note that names pages it never links is capture, not a stray', async () => {
  const w = world();
  await runLibrarianSweep(w.ctx);
  const captures = w.pings.find((p) => p.key === 'unprocessed-captures')!;
  assert.equal(captures.title, '1 capture note waiting to be processed');

  const [scratch] = orphanItems(captures);
  assert.equal(scratch!.path, 'notes/friday-scratch.md');
  assert.equal(scratch!.kind, 'capture');
  assert.deepEqual(
    scratch!.names?.map((n) => n.slug).sort(),
    ['customers/kranelund-logistics', 'people/sara-lindqvist'],
    'a proper-name page is matched by the short form prose uses ("sara", "kranelund")',
  );
});

test('a descriptive title is never matched on its leading word alone', async () => {
  const w = world();
  await runLibrarianSweep(w.ctx);
  const captures = w.pings.find((p) => p.key === 'unprocessed-captures')!;
  const [scratch] = orphanItems(captures);
  // The dump says "scheduled exports"; the theme page is "Scheduled Reporting".
  // Reading a common adjective as a page reference would invent the connection.
  assert.ok(
    !scratch!.names?.some((n) => n.slug === 'themes/scheduled-reporting'),
    '"scheduled" is an adjective, not a name',
  );
});

test('a page that cites nothing and is cited by nothing stays the hygiene case', async () => {
  const w = world();
  await runLibrarianSweep(w.ctx);
  // Below the floor for a card of its own, but the classification still holds —
  // this is the one kind of note the row may offer to delete.
  const report = getMaintenanceReport(w.ctx);
  assert.ok(report.orphans.some((o) => o.path === 'notes/leftover.md' && !o.external));
});

test('processing an item records the handoff and retires the card', async () => {
  const w = world();
  await runLibrarianSweep(w.ctx);
  const captures = w.pings.find((p) => p.key === 'unprocessed-captures')!;

  const after = await resolvePingItem(w.ctx, captures.id, 'notes/friday-scratch.md', { action: 'process' });
  assert.deepEqual(orphanItems(after!)[0]!.resolution, { action: 'processing' });
  assert.equal(after!.status, 'resolved', 'every item settled, so the card retires itself');
});

test('a mirror is offered where its KEY is mentioned, not just its title', async () => {
  const w = fakeDriftWorld({
    notes: [
      ticket('PAY-5', 'In Progress', 'in_progress'),
      ticket('PAY-6', 'To Do', 'open'),
      inote({ path: 'notes/standup.md', type: 'note', title: 'Standup Log', links: ['themes/exports'] }),
      inote({ path: 'themes/exports.md', type: 'theme', title: 'Scheduled Exports', links: ['notes/standup'] }),
    ],
    bodies: {
      'tickets/PAY-5.md': 'Retry failed webhook deliveries.',
      'tickets/PAY-6.md': 'Reconciliation filter.',
      'notes/standup.md': 'tom is picking up PAY-5 this week\nsee [[themes/exports]]',
      'themes/exports.md': 'see [[notes/standup]]',
    },
    completions: null,
    search: true,
  });
  await runLibrarianSweep(w.ctx);
  const mirrors = w.pings.find((p) => p.key === 'unconnected-mirrors')!;
  const pay5 = orphanItems(mirrors).find((i) => i.path === 'tickets/PAY-5.md')!;
  assert.deepEqual(
    pay5.mentions.map((m) => ({ host: m.host, term: m.term })),
    [{ host: 'notes/standup.md', term: 'PAY-5' }],
  );

  // And the applied patch links the key that actually appears in the prose.
  const written: { path: string; body: string }[] = [];
  w.ctx.vault.writeBody = async (path: string, body: string) => {
    written.push({ path, body });
    return (await w.ctx.vault.readNote(path))!;
  };
  await resolvePingItem(w.ctx, mirrors.id, 'tickets/PAY-5.md', {
    action: 'fix',
    choice: 'notes/standup.md',
  });
  assert.match(written[0]!.body, /\[\[tickets\/PAY-5\]\]/);
});
