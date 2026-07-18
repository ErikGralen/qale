import { createProposal, type UseCaseContext } from '@pm/application';

/** Dev-only: seed an insight card so the Inbox is demoable without an API key. */
export function seedDemoProposal(ctx: UseCaseContext): void {
  if (ctx.proposals.pendingCount() > 0) return;
  const meeting = ctx.index.listByType('meeting')[0];
  if (!meeting) return;
  createProposal(ctx, {
    kind: 'note',
    sessionId: 'seed',
    targetPath: 'insights/seed-demo.md',
    baseHash: null,
    payload: {
      path: 'insights/seed-demo.md',
      frontmatter: { type: 'insight', summary: 'Seed insight from the demo meeting', evidence: [`[[${meeting.slug}]]`], confidence: 'med' },
      body: 'A demo insight showing the approval-card flow.\n',
      rationale: 'Demonstrates the Inbox card without a live model.',
    },
    rationale: 'File a new insight heard in the demo meeting — this is what an approval card looks like.',
    evidence: [{ ref: `[[${meeting.slug}]]`, resolved: true }],
    inference: false,
  });
  // A demo agent ping so the "Agent noticed" inbox section is demoable too.
  if (ctx.pings && ctx.pings.pendingCount() === 0) {
    ctx.pings.create(
      {
        key: 'demo-ping',
        title: 'Release page still says v2.2 — two meetings mention v2.3',
        body: 'Two meetings mention v2.3 shipping, but the release page still describes v2.2. Want to reconcile them together?',
        evidence: [{ ref: `[[${meeting.slug}]]`, resolved: true }],
        sessionType: 'librarian',
        seedPrompt:
          'The release page and recent meetings disagree: the meetings mention a newer ship (v2.3) than the release page describes (v2.2). Read the release page and the recent meetings, then propose updates for what changed.',
        targetPath: null,
      },
      Date.now(),
    );
  }
  // A demo outbound draft card (message tier — no external write needed).
  createProposal(ctx, {
    kind: 'outbound',
    sessionId: 'seed',
    targetPath: null,
    baseHash: null,
    payload: {
      system: 'message',
      action: 'message',
      audience: 'exec',
      title: 'Nordkap SSO on track',
      body: 'WorkOS SSO is live in staging; SCIM lands in September. Nordkap renewal unblocked.',
      linkBackPath: `${meeting.path}`,
      rationale: 'Exec update drafted from the QBR.',
    },
    rationale: 'Exec update drafted from the QBR.',
    evidence: [{ ref: `[[${meeting.slug}]]`, resolved: true }],
    inference: false,
  });
}
