import { createProposal, type UseCaseContext } from '@qale/application';

/**
 * Dev-only: seed a spread of approval cards so the whole Inbox / in-session
 * review is demoable without an API key. One arrival review (a new
 * insight, a decision that replaces an earlier one, a note on the meeting
 * summary, an exec update to send) plus a supersede sweep (one decision changed,
 * so a couple of notes still point at the old plan — the cause block). Every
 * card carries an agent-style human `headline` so the redesign renders exactly
 * as it will in production. Gated behind QALE_SEED_PROPOSAL.
 */
export async function seedDemoProposal(ctx: UseCaseContext): Promise<void> {
  try {
    if (ctx.proposals.pendingCount() > 0) return;
    const meeting = ctx.index.listByType('meeting')[0];
    if (!meeting) return;
    const ev = [{ ref: `[[${meeting.slug}]]`, resolved: true }];
    const decisionSlug = 'decisions/2026-07-20-commit-scim-dates-nordkap';

    // A new insight heard in the meeting.
    createProposal(ctx, {
      kind: 'note',
      sessionId: 'seed',
      skill: 'arrival',
      targetPath: 'insights/seed-demo.md',
      baseHash: null,
      payload: {
        path: 'insights/seed-demo.md',
        frontmatter: {
          type: 'insight',
          summary: 'Sara wants SSO before the August rollout',
          evidence: [`[[${meeting.slug}]]`],
          confidence: 'med',
        },
        body: '## Insight\n\nSara flagged that **SSO must be live before August** or the Nordkap rollout slips. She was explicit this is a gate, not a nice-to-have.\n',
        rationale: 'A new insight heard in the demo meeting.',
        headline:
          'Learned: Sara says SSO must be live before August, or the Nordkap rollout slips.',
      },
      rationale:
        'Sara raised this as a hard gate on the rollout — worth remembering as its own insight.',
      evidence: ev,
      inference: false,
    });

    // A note the PM asked for in the chat. There is no meeting behind it and
    // nothing to cite, so it carries the `asked` basis: the card says they asked
    // rather than flagging their own words as an unsourced guess. No authored
    // headline either, so the mechanical "New note: <summary>" runs long and the
    // "Files as" line under it is the only thing naming the file.
    createProposal(ctx, {
      kind: 'note',
      sessionId: 'seed',
      targetPath: 'notes/dropped-material-tags.md',
      baseHash: null,
      payload: {
        path: 'notes/dropped-material-tags.md',
        frontmatter: {
          type: 'note',
          summary:
            'Convention for dropped external material: tag competitors `competitor` and analyses of comparable systems `prior-art`, on the source note and on anything derived from it.',
          tags: ['research'],
        },
        body: '## The two tags\n\n`competitor`: material about a product that competes with Qale for the same buyer and the same job.\n\n`prior-art`: analysis of a system that is not a competitor but is worth learning from.\n',
        rationale: 'You asked for two standing tags for the material you are about to drop in.',
      },
      rationale: 'You asked for two standing tags for the material you are about to drop in.',
      evidence: [],
      inference: false,
      asked: true,
    });

    // A new decision that replaces an earlier one — shows the "replaces …" line
    // (by human title) and the rendered Markdown preview.
    createProposal(ctx, {
      kind: 'decision',
      sessionId: 'seed',
      skill: 'arrival',
      targetPath: `${decisionSlug}.md`,
      baseHash: null,
      payload: {
        path: `${decisionSlug}.md`,
        frontmatter: {
          type: 'decision',
          date: '2026-07-20',
          status: 'accepted',
          decider: 'Product',
          supersedes: 'decisions/2026-04-15-defer-scim-to-q3',
        },
        body: '# Commit SCIM dates for Nordkap\n\nSCIM provisioning ships **in September**, with SSO already live in staging. This replaces the earlier "defer to Q3, no date inside the month" position now that engineering has committed.\n\n- **Owner:** Product\n- **Because:** the Nordkap renewal is gated on a firm date.\n',
        rationale: 'Record the decision to commit SCIM dates, pointing past the deferred one.',
        supersedes: 'decisions/2026-04-15-defer-scim-to-q3',
        headline: 'Decided: commit SCIM dates for September — replaces the earlier “defer to Q3”.',
      },
      rationale:
        'Engineering committed to a September ship, so the earlier "defer to Q3" call no longer holds — recording the new one keeps the memory current.',
      evidence: ev,
      inference: false,
    });

    // An edit to the meeting page — a real, matching patch so the diff preview
    // renders with removed/added content (the change the demo actually shows).
    const note = await ctx.vault.readNote(meeting.path);
    const anchor = note?.body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 8 && !l.startsWith('#'));
    if (anchor) {
      createProposal(ctx, {
        kind: 'update',
        sessionId: 'seed',
        skill: 'arrival',
        targetPath: meeting.path,
        baseHash: null,
        payload: {
          path: meeting.path,
          patch: [
            {
              search: anchor,
              replace: `${anchor}\n\n> **Decision:** SCIM dates committed for September — see the new decision.`,
            },
          ],
          rationale: 'Note the committed SCIM dates on the meeting page.',
          headline: 'Note on the meeting summary that SCIM dates are now committed for September.',
        },
        rationale:
          'Capture the decision on the meeting summary itself, so the record reads on its own.',
        evidence: ev,
        inference: false,
      });
    }

    // A demo outbound draft card (message tier — no external write needed).
    createProposal(ctx, {
      kind: 'outbound',
      sessionId: 'seed',
      skill: 'arrival',
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
        headline: 'Send the exec update: Nordkap SSO on track, SCIM in September.',
      },
      rationale: 'Drafted for the exec channel from the QBR — send only if it reads right.',
      evidence: ev,
      inference: false,
    });

    // A ticket comment (Area D outbound upgrades): target line with the live
    // PAY-142 chip. Backdated 5h so the mock mirror's 2h-old "In Review →
    // Blocked" transition trips the drafted-against-stale banner.
    ctx.proposals.create(
      {
        kind: 'outbound',
        sessionId: 'seed',
        skill: 'arrival',
        targetPath: null,
        baseHash: null,
        payload: {
          provider: 'jira',
          system: 'jira',
          action: 'comment_ticket',
          issueKey: 'PAY-142',
          title: 'Nordkap confirms first-tenant go-live Jul 28',
          body: 'Nordkap confirms first-tenant go-live **Jul 28**. SCIM group-mapping is required before the September rollout — tracked separately.\n\n— from the Nordkap check-in, Jul 14',
          linkBackPath: meeting.path,
          rationale: 'Put the confirmed go-live date on the epic where engineering will see it.',
          headline: 'Comment on the SSO epic: Nordkap confirms first-tenant go-live Jul 28.',
        },
        rationale:
          'Sara confirmed the date in the check-in — the epic should say so before standup.',
        evidence: ev,
        inference: false,
      },
      Date.now() - 5 * 3_600_000,
    );

    // A wikipage edit (Area D): renders as a redline against the page's current
    // text — the "Confluence stewardship" scenario from the integration plan.
    createProposal(ctx, {
      kind: 'outbound',
      sessionId: 'seed',
      skill: 'librarian',
      targetPath: null,
      baseHash: null,
      payload: {
        provider: 'confluence',
        system: 'confluence',
        action: 'update_page',
        pageId: '910231',
        title: 'Enterprise Onboarding',
        body: [
          '## Provisioning',
          '',
          'Enterprise tenants authenticate via SAML SSO (WorkOS). Group and role assignment is manual during onboarding.',
          '',
          'SCIM provisioning ships in September (committed 2026-07-20); until then group mapping stays manual after SSO go-live.',
          '',
          '## Rollout checklist',
          '',
          '- IdP metadata exchanged and verified in staging',
          '- First-tenant flag enabled the week before go-live',
          '- Written go-live confirmation to the customer security contact',
        ].join('\n'),
        rationale: 'The page still promises SCIM in Q2; the committed decision says September.',
        headline: 'Fix the Enterprise Onboarding page — it still says SCIM ships in Q2.',
      },
      rationale:
        'This page contradicts the SCIM decision: it still tells readers SCIM ships in Q2 with automatic group mapping.',
      evidence: [{ ref: `[[${decisionSlug}]]`, resolved: true }],
      inference: false,
    });

    // A supersede sweep — one decision changed, so notes that still cite the old
    // plan are stale. Grouped in the Inbox as one cause block ("Because you
    // decided …, N notes still point at the old plan") with a batch approve.
    const decisionRef = `[[${decisionSlug}]]`;
    const sweepTargets = [
      ...ctx.index.listByType('theme'),
      ...ctx.index.listByType('customer'),
      ...ctx.index.listByType('insight'),
    ]
      .filter((n) => n.path !== meeting.path)
      .slice(0, 2);
    for (const cand of sweepTargets) {
      const cnote = await ctx.vault.readNote(cand.path);
      const canchor = cnote?.body
        .split('\n')
        .map((l) => l.trim())
        .find(
          (l) => l.length >= 12 && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('-'),
        );
      if (!canchor) continue;
      createProposal(ctx, {
        kind: 'update',
        sessionId: 'seed-sweep',
        skill: 'supersede-sweep',
        targetPath: cand.path,
        baseHash: null,
        payload: {
          path: cand.path,
          patch: [
            {
              search: canchor,
              replace: `${canchor}\n\n> Updated: SCIM dates are committed for September — the earlier "defer to Q3" plan no longer applies.`,
            },
          ],
          rationale: 'This still describes the deferred plan; repoint it at the committed dates.',
          headline: `${cand.title}: point it at the committed SCIM dates, not the deferred plan.`,
        },
        rationale:
          'This note still describes the old "defer to Q3" plan, which the new decision replaced.',
        evidence: [{ ref: decisionRef, resolved: true }],
        inference: false,
      });
    }
  } catch (err) {
    console.error('[qale] seedDemoProposal failed:', err instanceof Error ? err.message : err);
  }
}
