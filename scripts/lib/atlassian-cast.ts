/**
 * The Tavla cast: the desired state of the Atlassian demo site, in one place.
 * `scripts/reset-atlassian.ts` converges the live site to it, and
 * `scripts/build-demo-fixture.ts` bakes it into the offline fixture the demo
 * build's fake Atlassian serves (docs/demo-mode.md DM-8). Both must read the
 * same source, or the live demo and the offline demo drift apart.
 *
 * The file is plain data plus three pure text helpers. It has no imports, so
 * bare `node scripts/*.ts` type stripping runs it as is.
 */

export const ANCHOR = '2026-07-17';
export const PROJECT_KEY = 'PAY';
export const SPACE_NAME = 'Product';
export const SPACE_KEY = 'PRODUCT';
export const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
export const FRONTMATTER_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// ---------------------------------------------------------------------------
// The desired state. Summaries are the identity — the live site mints its own
// issue keys, so the script matches cast members by exact summary. Dates in
// any text are anchored on ANCHOR and shifted at runtime.
// ---------------------------------------------------------------------------

export interface CastIssue {
  summary: string;
  issueType: 'Epic' | 'Task';
  status: string;
  description: string;
  /** The one area label every PAY ticket carries, matching the `tags` on the
   *  static mirror in vault-dev/tickets/. It is the house shape the conventions
   *  skill names (docs/conventions.md CV-5), so the live site has to show it. */
  label: 'enterprise-auth' | 'reporting' | 'reliability';
  /** Seeded oldest-first after wiping the live thread. Comment authorship and
   *  timestamps are whoever runs the script, now — the story lives in the text. */
  comments?: string[];
  assignSelf?: boolean;
  childOfEpic?: boolean;
}

// The star + supporting cast (docs/jira-demo-setup.md §3, vault-dev/tickets/).
// "SCIM group-mapping for Nordkap" is deliberately absent: the after-meeting
// session drafts it as an approval card and approving creates it live — which
// is exactly why this script deletes it again on reset.
export const CAST: CastIssue[] = [
  {
    summary: 'SAML SSO (epic)',
    label: 'enterprise-auth',
    issueType: 'Epic',
    status: 'Blocked',
    assignSelf: true,
    description:
      'SAML SSO against customer IdPs via WorkOS. Rollout target 2026-07-28 behind a feature flag, ' +
      'Nordkap Payments as first tenant (they run Entra). General availability in August.',
    comments: [
      'Scoped per sprint planning. Audit-log export dependency split out as its own task.',
      'Staging verified against Okta and Entra. Moving to In Review.',
      'Moving to Blocked: the infra review flagged the WorkOS callback endpoints (secrets handling ' +
        'on the redirect path). Security sign-off is needed before the flag path can be enabled in ' +
        'production; review slot requested for 2026-07-20.',
    ],
  },
  {
    summary: 'Audit-log export for SSO events',
    label: 'enterprise-auth',
    issueType: 'Task',
    status: 'Done',
    childOfEpic: true,
    description:
      'Export SSO sign-in/sign-out events into the audit-log stream shipped in June, so enterprise ' +
      'security teams can trace access during the SSO rollout. Split out of the SAML SSO epic.',
    comments: [
      'Picked up after the internal auth review confirmed the export gap.',
      'Shipped behind the same flag family as SSO; verified in staging against the Nordkap tenant ' +
        'config. Closing.',
    ],
  },
  {
    summary: 'IdP metadata validation in staging',
    label: 'enterprise-auth',
    issueType: 'Task',
    status: 'In Progress',
    childOfEpic: true,
    description:
      'Validate customer IdP metadata exchange in staging ahead of the Nordkap go-live: Entra ' +
      'first (their stack), Okta as the regression pair.',
  },
  {
    summary: 'Payout report exports',
    label: 'reporting',
    issueType: 'Task',
    status: 'Done',
    description:
      'CSV and Excel payout report exports for finance teams. Shipped; feeds the Kranelund ' +
      'exports pilot.',
  },
  {
    summary: 'Webhook delivery retries with backoff',
    label: 'reliability',
    issueType: 'Task',
    status: 'To Do',
    description: 'Retry failed webhook deliveries with exponential backoff and a dead-letter view.',
  },
  {
    summary: 'Reconciliation report date-range filter',
    label: 'reporting',
    issueType: 'Task',
    status: 'To Do',
    description: 'Let finance filter the reconciliation report by settlement date range.',
  },
];

// Issue links between cast members, by summary. Direction per Jira's model:
// the INWARD issue applies the type's outward description to the OUTWARD issue
// ("IdP metadata validation" blocks "SAML SSO (epic)").
export const CAST_LINKS: { type: string; inward: string; outward: string }[] = [
  {
    type: 'Blocks',
    inward: 'IdP metadata validation in staging',
    outward: 'SAML SSO (epic)',
  },
];

// Canonical Confluence bodies come from the git-tracked mirrors so the
// load-bearing text (the SCIM sentence the librarian redlines) is verbatim by
// construction — vault-dev/wikipages/confluence/ is the single source of truth.
export const PAGES = [
  { title: 'Enterprise Onboarding', file: 'enterprise-onboarding.md' },
  { title: 'Product weekly update', file: 'product-weekly-update.md' },
];

// The fictional ids the canonical vault's static mirrors carry, mapped to the
// cast identity that owns them on the live site. Reconciliation rewrites these
// tokens (and the fake host) across the runtime vault.
export const STATIC_HOST = 'tavla.atlassian.net';
export const STATIC_TICKETS: Record<string, string> = {
  'PAY-142': 'SAML SSO (epic)',
  'PAY-156': 'Audit-log export for SSO events',
  'PAY-161': 'IdP metadata validation in staging',
  'PAY-148': 'Payout report exports',
  'PAY-165': 'Webhook delivery retries with backoff',
  'PAY-167': 'Reconciliation report date-range filter',
};
export const STATIC_PAGE_IDS: Record<string, string> = {
  '910231': 'Enterprise Onboarding',
  '18350081': 'Product weekly update',
};

// ---------------------------------------------------------------------------
// Markdown → Atlassian formats. Deliberately tiny: they only need to cover the
// canonical demo content (headings, paragraphs, bullets, bold/italic/code).
// ---------------------------------------------------------------------------

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function inlineStorage(s: string): string {
  return escapeXml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToStorage(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      out.push(`<h${heading[1].length}>${inlineStorage(heading[2])}</h${heading[1].length}>`);
      i++;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li><p>${inlineStorage(lines[i].replace(/^[-*]\s+/, ''))}</p></li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*]\s)/.test(lines[i])) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(`<p>${inlineStorage(para.join(' '))}</p>`);
  }
  return out.join('');
}
