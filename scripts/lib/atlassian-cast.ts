/**
 * The Rota cast: the desired state of the Atlassian demo site, in one place.
 * `scripts/reset-atlassian.ts` converges the live site to it, and
 * `scripts/build-demo-fixture.ts` bakes it into the offline fixture the demo
 * build's fake Atlassian serves (docs/demo-mode.md DM-8). Both must read the
 * same source, or the live demo and the offline demo drift apart.
 *
 * The file is plain data plus three pure text helpers. It has no imports, so
 * bare `node scripts/*.ts` type stripping runs it as is.
 */

export const ANCHOR = '2026-07-17';

/** The three Jira projects the scenario spans. They must exist on the site —
 *  the script creates issues, never projects (see reset-atlassian.ts's
 *  preconditions). Scheduling and Staff app are the PO's own two teams. */
export const PROJECT_KEYS = ['SCH', 'APP', 'PLT'] as const;
export type ProjectKey = (typeof PROJECT_KEYS)[number];
export const PROJECT_NAMES: Record<ProjectKey, string> = {
  SCH: 'Scheduling',
  APP: 'Staff app',
  PLT: 'Platform',
};

export const SPACE_NAME = 'Product';
export const SPACE_KEY = 'PROD';
export const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
export const FRONTMATTER_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// ---------------------------------------------------------------------------
// The desired state. Summaries are the identity — the live site mints its own
// issue keys, so the script matches cast members by exact summary. `key` is the
// STATIC key the canonical mirror in vault-dev/tickets/jira/ carries, which is
// what the offline fixture serves and what reconciliation rewrites when the
// live site hands out different ones. Dates in any text are anchored on ANCHOR
// and shifted at runtime.
// ---------------------------------------------------------------------------

/** The one area label every cast issue carries, matching the `tags` on its
 *  static mirror. It is the house shape the conventions skill names
 *  (docs/conventions.md CV-5), so the live site has to show it. */
export const CAST_LABELS = ['shift-swaps', 'payroll-export', 'platform', 'staff-app'] as const;
export type CastLabel = (typeof CAST_LABELS)[number];

export interface CastIssue {
  /** The static key its canonical mirror carries, e.g. "SCH-231". */
  key: string;
  project: ProjectKey;
  summary: string;
  issueType: 'Epic' | 'Story' | 'Task';
  status: string;
  description: string;
  label: CastLabel;
  /** Seeded oldest-first after wiping the live thread. Comment authorship and
   *  timestamps are whoever runs the script, now — the story lives in the text. */
  comments?: string[];
  assignSelf?: boolean;
  /** The SUMMARY of the epic this one hangs under — resolved to a live key at
   *  run time, because the site mints its own. */
  parent?: string;
}

// The star + supporting cast (vault-dev/tickets/jira/). Anything the demo
// CREATES live is deliberately absent — the swap-notification story the
// after-meeting session drafts as an approval card, for one — which is exactly
// why this script deletes non-cast issues again on reset.
export const CAST: CastIssue[] = [
  {
    key: 'SCH-231',
    project: 'SCH',
    summary: 'Shift swaps (epic)',
    label: 'shift-swaps',
    issueType: 'Epic',
    status: 'In Progress',
    assignSelf: true,
    description:
      'Staff propose a shift swap in the app, the affected colleague accepts, the manager ' +
      'approves, and the schedule updates for both people. Three stories: the swap request ' +
      'model and API, the request screen in the staff app, and the manager approval flow. ' +
      'Rules: same role, same location, manager approves, no overtime beyond contract.',
    comments: [
      'Scope agreed: same role, same location, manager approves, and a swap can never push ' +
        'either person past their contracted hours. Split into three stories.',
      'The model/API story and the staff-app screen are Done. The manager approval flow is what ' +
        'is left, and the overtime check in it is bigger than the original estimate. Re-estimate ' +
        'before anyone quotes a date.',
    ],
  },
  {
    key: 'SCH-232',
    project: 'SCH',
    summary: 'Swap request model and API',
    label: 'shift-swaps',
    issueType: 'Story',
    status: 'Done',
    parent: 'Shift swaps (epic)',
    description:
      'A swap request as a first-class object: who proposes it, which shift, which colleague, ' +
      'and the state it is in (proposed, accepted by the colleague, approved, rejected). Plus ' +
      'the REST endpoints the staff app and the manager web both read and write.',
    comments: [
      'Endpoints are live behind the swaps flag, with same-role and same-location validation on ' +
        'the request itself. Closing.',
    ],
  },
  {
    key: 'SCH-236',
    project: 'SCH',
    summary: 'Swap request screen in staff app',
    label: 'shift-swaps',
    issueType: 'Story',
    status: 'Done',
    parent: 'Shift swaps (epic)',
    description:
      'The staff-app screen where someone picks one of their own shifts, picks a colleague who ' +
      'can work that role at that location, and sends the swap request. Includes the list of ' +
      'requests they have sent and received.',
    comments: [
      'Shipped behind the swaps flag. The sent/received list reuses the shift list component, so ' +
        'nothing new to maintain. Closing.',
    ],
  },
  {
    key: 'SCH-240',
    project: 'SCH',
    summary: 'Manager approval flow and schedule update',
    label: 'shift-swaps',
    issueType: 'Story',
    status: 'In Progress',
    parent: 'Shift swaps (epic)',
    description:
      "The manager sees the week's pending swaps, approves or rejects each one, and an approval " +
      'rewrites the schedule for both people. The approval must refuse anything that pushes ' +
      'either person past their contracted hours for the week.',
    comments: [
      'Approval list and the reject path work against the API. Starting on the schedule write.',
      'This needs a re-estimate. The overtime check has to run against both people’s ' +
        'contracted hours for the whole week, not just the two shifts, and the week can already ' +
        'contain other approved swaps. I would rather re-estimate than give a date now.',
    ],
  },
  {
    key: 'SCH-118',
    project: 'SCH',
    summary: 'Payroll export (epic)',
    label: 'payroll-export',
    issueType: 'Epic',
    status: 'In Progress',
    assignSelf: true,
    description:
      "Approved hours from the schedule go to the customer's payroll system instead of being " +
      'retyped. A CSV export first, then a direct Fortnox connector; Visma after that. Fortnox ' +
      'is the first target.',
    comments: [
      'The approved-hours CSV is out. The Fortnox connector is in progress and needs the ' +
        'platform token store before it can hold real customer credentials.',
    ],
  },
  {
    key: 'SCH-121',
    project: 'SCH',
    summary: 'Approved-hours export (CSV)',
    label: 'payroll-export',
    issueType: 'Story',
    status: 'Done',
    parent: 'Payroll export (epic)',
    description:
      'Export approved hours for a period as CSV: person, location, date, hours, cost centre. ' +
      'One column set that both Fortnox and Visma accept, so the connectors later map from the ' +
      'same shape.',
    comments: [
      'Column set verified against a real Fortnox import template and a Visma one. Closing.',
      'Enabled for every chain in the 24 June release. Managers export from the period view.',
    ],
  },
  {
    key: 'SCH-125',
    project: 'SCH',
    summary: 'Fortnox connector',
    label: 'payroll-export',
    issueType: 'Story',
    status: 'In Progress',
    parent: 'Payroll export (epic)',
    description:
      'Push approved hours straight into Fortnox instead of handing the manager a file: OAuth ' +
      "against the customer's Fortnox account, locations mapped to cost centres, one push per " +
      'period, and a readable report of what Fortnox rejected.',
    comments: [
      'Mapping and the push work against the Fortnox sandbox. Real customer accounts need ' +
        'somewhere to keep refresh tokens, which is the platform token store — I am not putting ' +
        'them in this service.',
    ],
  },
  {
    key: 'PLT-77',
    project: 'PLT',
    summary: 'OAuth token store for integrations',
    label: 'platform',
    issueType: 'Task',
    status: 'In Progress',
    description:
      'One encrypted store for third-party OAuth tokens — Fortnox first, Visma next — with ' +
      'refresh handling and per-tenant isolation, so every integration does not invent its own.',
    comments: [
      'Encryption and per-tenant isolation are in. Refresh-on-expiry is the piece left, and the ' +
        'Fortnox connector needs it before it can talk to a real Fortnox account.',
    ],
  },
  {
    key: 'PLT-80',
    project: 'PLT',
    summary: 'Nightly schedule backup job',
    label: 'platform',
    issueType: 'Task',
    status: 'Done',
    description:
      'Nightly snapshot of every published schedule to object storage with 30-day retention, so ' +
      "a bad bulk edit on a chain's week can be rolled back instead of rebuilt by hand.",
  },
  {
    key: 'APP-54',
    project: 'APP',
    summary: 'Push notification opt-in screen',
    label: 'staff-app',
    issueType: 'Story',
    status: 'Done',
    description:
      'Ask for push permission at the moment it means something — after the first shift is ' +
      'visible, not on first launch — and let staff turn shift reminders on and off from ' +
      'settings.',
    comments: [
      'Shipped in the 15 July staff-app release. Shift reminders are on by default once the ' +
        'first shift is visible.',
    ],
  },
];

// Issue links between cast members, by summary. Direction per Jira's model:
// the INWARD issue applies the type's outward description to the OUTWARD issue
// ("OAuth token store" blocks "Fortnox connector").
export const CAST_LINKS: { type: string; inward: string; outward: string }[] = [
  {
    type: 'Blocks',
    inward: 'OAuth token store for integrations',
    outward: 'Fortnox connector',
  },
];

// Canonical Confluence bodies come from the git-tracked mirrors so the
// load-bearing text (the two numbered roadmap lines the demo patches) is
// verbatim by construction — vault-dev/wikipages/confluence/ is the single
// source of truth.
export const PAGES = [
  { title: 'Roadmap H2', file: 'roadmap-h2.md' },
  { title: 'Product weekly update', file: 'product-weekly-update.md' },
];

// The fictional ids the canonical vault's static mirrors carry, mapped to the
// cast identity that owns them on the live site. Reconciliation rewrites these
// tokens (and the fake host) across the runtime vault.
export const STATIC_HOST = 'rota.atlassian.net';
/** Static key → cast summary, derived so the cast can never drift from it. */
export const STATIC_TICKETS: Record<string, string> = Object.fromEntries(
  CAST.map((m) => [m.key, m.summary]),
);
export const STATIC_PAGE_IDS: Record<string, string> = {
  '4521985': 'Roadmap H2',
  '4784129': 'Product weekly update',
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
