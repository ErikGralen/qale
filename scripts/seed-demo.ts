/**
 * Seed the demo workspace (PLAN-V2 Phase 1.5): one customer (acme-co), one
 * problem hub, 6 decisions with a supersedes-chain, 2 meetings with transcripts,
 * and insights with mixed freshness. Deterministic — run with:
 *   npx tsx scripts/seed-demo.ts [targetDir=.vault-dev]
 *
 * Dates are relative to the concept's "today" (2026-07-14) so freshness demos:
 * one fresh insight, one stale, one unverified.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.vault-dev');

function write(rel: string, frontmatter: Record<string, unknown>, body: string): void {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${fmt(v)}`)
    .join('\n');
  writeFileSync(abs, `---\n${yaml}\n---\n\n${body.trim()}\n`, 'utf8');
}

function fmt(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
  // Always quote string scalars: wikilinks ("[[…]]") would otherwise parse as
  // nested YAML sequences, and colons/hashes break the scalar.
  if (typeof v === 'string') return JSON.stringify(v);
  return String(v);
}

// ── Customer ────────────────────────────────────────────────────────────────
write(
  'customers/acme-co.md',
  { type: 'customer', summary: 'Acme Co — 400-seat fintech, our largest enterprise account', status: 'active', segment: 'enterprise', last_verified: '2026-07-05' },
  `# Acme Co

Largest enterprise account (400 seats, fintech). Champion: [[people/sara-lindqvist]].

## Commitments
- SCIM provisioning by end of Q3 — see [[decisions/2026-04-15-defer-scim-to-q3]]
- SSO via WorkOS — [[decisions/2026-05-20-adopt-workos]]
- EU data residency — [[decisions/2026-06-05-single-region-eu]]

## What they were told
- 2026-05-18 QBR: audit log shipping in June (delivered — [[releases/2026-06-audit-log]]).

## Open questions
- Will per-seat pricing survive their procurement review? ([[insights/pricing-sensitivity-midmarket]])`,
);

// ── People ───────────────────────────────────────────────────────────────────
write(
  'people/sara-lindqvist.md',
  { type: 'person', summary: 'Sara Lindqvist — Head of IT at Acme, our economic buyer', role: 'Head of IT, Acme', cares_about: ['security', 'provisioning', 'audit'], last_told: '2026-05-18', customer: '[[customers/acme-co]]' },
  `Champion and economic buyer at [[customers/acme-co]]. Pushed hard for SSO + SCIM. Cares most about auditability.`,
);
write(
  'people/tom-devlin.md',
  { type: 'person', summary: 'Tom Devlin — our eng lead for auth & onboarding', role: 'Engineering Lead', cares_about: ['auth', 'reliability'] },
  `Internal engineering lead. Owns the auth migration ([[decisions/2026-05-20-adopt-workos]]).`,
);

// ── Problem hub ──────────────────────────────────────────────────────────────
write(
  'problems/enterprise-onboarding.md',
  {
    type: 'problem',
    summary: 'Enterprise onboarding friction — SSO/SCIM/audit are gating deals',
    stance: 'committed',
    evidence: ['[[insights/acme-needs-scim]]', '[[insights/enterprise-wants-sso]]', '[[insights/eu-data-residency-required]]', '[[meetings/2026-05-18-acme-qbr]]'],
    customer: '[[customers/acme-co]]',
    last_verified: '2026-07-05',
  },
  `# Enterprise onboarding

Enterprise buyers (led by [[customers/acme-co]]) cannot self-onboard: no SSO, no SCIM, thin audit
trail. This is the top gating problem for deals >250 seats.

## Evidence
- [[insights/enterprise-wants-sso]]
- [[insights/acme-needs-scim]]
- [[insights/eu-data-residency-required]]

## Decisions
- [[decisions/2026-05-20-adopt-workos]] (supersedes [[decisions/2026-02-10-use-firebase-auth]])
- [[decisions/2026-04-15-defer-scim-to-q3]]`,
);

// ── Meetings (with transcripts) ──────────────────────────────────────────────
write(
  'meetings/2026-05-18-acme-qbr.md',
  { type: 'meeting', summary: 'Acme Q2 QBR — SSO/SCIM asks, audit log commitment', date: '2026-05-18', participants: ['Sara Lindqvist', 'Tom Devlin', 'You'], customer: '[[customers/acme-co]]' },
  `## Summary
Acme confirmed SSO is a hard requirement for their security review; SCIM wanted but Q3 is acceptable.
We committed to an audit log in June. See [[decisions/2026-05-20-adopt-workos]].

## Transcript
Sara: The security team won't sign off without SSO. That's non-negotiable for the renewal.
You: Understood — we're moving auth to WorkOS, which gives you SAML SSO out of the box.
Sara: Good. SCIM provisioning too — we can't hand-manage 400 accounts.
You: SCIM is on the roadmap for Q3. Would that timeline work?
Sara: Q3 works if SSO lands first. And we need an audit log for compliance.
Tom: Audit log is close — we can ship it in June.
Sara: Great. One more: all our data has to stay in the EU.
You: Noted, we'll confirm the region setup.`,
);
write(
  'meetings/2026-07-10-internal-auth-review.md',
  { type: 'meeting', summary: 'Internal auth review — WorkOS migration status, audit log shipped', date: '2026-07-10', participants: ['Tom Devlin', 'You'] },
  `## Summary
WorkOS migration on track; Firebase Auth fully retired. Audit log shipped in June. Confirmed
single-region EU deployment for Acme.

## Transcript
Tom: WorkOS is live in staging, SAML working. Firebase is out — we can mark that decision superseded.
You: Good. Audit log went out in June, right?
Tom: Yes, released. Acme can see it now.
Tom: We locked the deployment to eu-central-1 for data residency.`,
);

// ── Decisions (6, incl. a supersedes-chain) ──────────────────────────────────
write(
  'decisions/2026-02-10-use-firebase-auth.md',
  { type: 'decision', summary: 'Use Firebase Auth for authentication (INITIAL — later superseded)', status: 'superseded', date: '2026-02-10', deciders: ['Tom Devlin'], sources: [], superseded_by: '[[decisions/2026-05-20-adopt-workos]]', problem: '[[problems/enterprise-onboarding]]' },
  `We chose Firebase Auth for speed of integration. **Superseded** — Firebase lacked SAML SSO and
enterprise SCIM, which Acme required. See [[decisions/2026-05-20-adopt-workos]].`,
);
write(
  'decisions/2026-05-20-adopt-workos.md',
  { type: 'decision', summary: 'Adopt WorkOS for enterprise auth (SSO + SCIM)', status: 'active', date: '2026-05-20', deciders: ['Tom Devlin', 'You'], sources: ['[[meetings/2026-05-18-acme-qbr]]'], supersedes: '[[decisions/2026-02-10-use-firebase-auth]]', problem: '[[problems/enterprise-onboarding]]', last_verified: '2026-07-10' },
  `Adopt WorkOS to unblock enterprise onboarding: SAML SSO now, SCIM in Q3. Driven by
[[customers/acme-co]]'s security review ([[meetings/2026-05-18-acme-qbr]]). Supersedes
[[decisions/2026-02-10-use-firebase-auth]].`,
);
write(
  'decisions/2026-03-01-charge-per-seat.md',
  { type: 'decision', summary: 'Price per seat for the enterprise tier', status: 'active', date: '2026-03-01', deciders: ['You'], sources: [] },
  `Enterprise tier is priced per seat. Under review pending Acme procurement feedback
([[insights/pricing-sensitivity-midmarket]]).`,
);
write(
  'decisions/2026-04-15-defer-scim-to-q3.md',
  { type: 'decision', summary: 'Defer SCIM provisioning to Q3', status: 'active', date: '2026-04-15', deciders: ['You', 'Tom Devlin'], sources: ['[[meetings/2026-05-18-acme-qbr]]'], problem: '[[problems/enterprise-onboarding]]' },
  `SCIM slips to Q3; SSO ships first. Acme accepted this sequencing at the QBR.`,
);
write(
  'decisions/2026-06-05-single-region-eu.md',
  { type: 'decision', summary: 'Deploy Acme in a single EU region (eu-central-1)', status: 'active', date: '2026-06-05', deciders: ['Tom Devlin'], sources: ['[[meetings/2026-07-10-internal-auth-review]]'], customer: '[[customers/acme-co]]' },
  `All Acme data stays in eu-central-1 for residency compliance.`,
);
write(
  'decisions/2026-07-01-ship-audit-log.md',
  { type: 'decision', summary: 'Ship the audit log to enterprise customers', status: 'active', date: '2026-07-01', deciders: ['Tom Devlin'], sources: ['[[releases/2026-06-audit-log]]'] },
  `Audit log shipped to enterprise; fulfils the QBR commitment to [[customers/acme-co]].`,
);

// ── Insights (mixed freshness) ───────────────────────────────────────────────
write(
  'insights/acme-needs-scim.md',
  { type: 'insight', summary: 'Acme needs SCIM to manage 400 accounts (verified)', evidence: ['[[meetings/2026-05-18-acme-qbr]]'], confidence: 'high', customer: '[[customers/acme-co]]', problem: '[[problems/enterprise-onboarding]]', last_verified: '2026-07-05' },
  `Acme cannot hand-manage 400 accounts — SCIM provisioning is required. Fresh: reconfirmed 2026-07-05.`,
);
write(
  'insights/enterprise-wants-sso.md',
  { type: 'insight', summary: 'Enterprise buyers gate on SSO (going stale)', evidence: ['[[meetings/2026-05-18-acme-qbr]]'], confidence: 'med', problem: '[[problems/enterprise-onboarding]]', last_verified: '2025-11-01' },
  `SSO is a hard gate for enterprise security reviews. **Stale** — last verified 2025-11-01, past the
90-day insight clock; the nightly sweep should flag this for re-verification.`,
);
write(
  'insights/pricing-sensitivity-midmarket.md',
  { type: 'insight', summary: 'Mid-market is price-sensitive on per-seat (unverified)', evidence: ['[[meetings/2026-05-18-acme-qbr]]'], confidence: 'low', customer: '[[customers/acme-co]]' },
  `Some signals that per-seat pricing meets procurement resistance. **Unverified** — no last_verified
stamp yet; thin evidence (one account).`,
);
write(
  'insights/eu-data-residency-required.md',
  { type: 'insight', summary: 'EU data residency is a hard requirement for Acme (verified)', evidence: ['[[meetings/2026-07-10-internal-auth-review]]', '[[meetings/2026-05-18-acme-qbr]]'], confidence: 'high', customer: '[[customers/acme-co]]', last_verified: '2026-07-10' },
  `Acme requires all data in the EU; we deploy single-region eu-central-1
([[decisions/2026-06-05-single-region-eu]]).`,
);

// ── Release ──────────────────────────────────────────────────────────────────
write(
  'releases/2026-06-audit-log.md',
  { type: 'release', summary: 'Audit log for enterprise customers', date: '2026-06-20', status: 'shipped', audiences: ['enterprise', 'security'] },
  `Shipped the enterprise audit log in June 2026. Fulfils the [[customers/acme-co]] QBR commitment.`,
);

console.log(`Seeded demo workspace at ${root}`);
