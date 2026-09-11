/**
 * The Bord cast: the desired state of the Atlassian demo site, in one place.
 * `scripts/reset-atlassian.ts` converges the live site to it, and
 * `scripts/build-demo-fixture.ts` bakes it into the offline fixture the demo
 * build's fake Atlassian serves (docs/demo-mode.md DM-8). Both must read the
 * same source, or the live demo and the offline demo drift apart.
 *
 * The file is plain data plus three pure text helpers. It has no imports, so
 * bare `node scripts/*.ts` type stripping runs it as is.
 */

export const ANCHOR = '2026-07-17';

/** The three Jira projects the scenario spans. They must exist on the site:
 *  the script creates issues, never projects (see reset-atlassian.ts's
 *  preconditions). Bookings and Guest are the PO's own two teams. Payments is
 *  Henrik's, and the demo only waits on it. */
export const PROJECT_KEYS = ['BOK', 'GST', 'PAY'] as const;
export type ProjectKey = (typeof PROJECT_KEYS)[number];
export const PROJECT_NAMES: Record<ProjectKey, string> = {
  BOK: 'Bookings',
  GST: 'Guest',
  PAY: 'Payments',
};

export const SPACE_NAME = 'Product';
export const SPACE_KEY = 'PROD';
export const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
export const FRONTMATTER_RE = /^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/;

// ---------------------------------------------------------------------------
// The desired state. Summaries are the identity: the live site mints its own
// issue keys, so the script matches cast members by exact summary. `key` is the
// STATIC key the canonical mirror in vault-dev/tickets/jira/ carries, which is
// what the offline fixture serves and what reconciliation rewrites when the
// live site hands out different ones. Dates in any text are anchored on ANCHOR
// and shifted at runtime.
// ---------------------------------------------------------------------------

/** The one area label every cast issue carries, matching the `tags` on its
 *  static mirror. It is the house shape the conventions skill names
 *  (docs/conventions.md CV-5), so the live site has to show it. */
export const CAST_LABELS = [
  'no-show-fees',
  'waitlist',
  'group-bookings',
  'reminders',
  'booking-page',
  'payments',
] as const;
export type CastLabel = (typeof CAST_LABELS)[number];

/** One comment on the thread. The author and the date are the story's, not the
 *  run's: the fixture builder stamps them straight onto the fake's thread. A
 *  live site can only post as the account running the script, so there the
 *  author is dropped and the text carries the story. */
export interface CastComment {
  author: string;
  /** ANCHOR-relative date, YYYY-MM-DD. */
  date: string;
  body: string;
}

export interface CastIssue {
  /** The static key its canonical mirror carries, e.g. "BOK-300". */
  key: string;
  project: ProjectKey;
  summary: string;
  issueType: 'Epic' | 'Story' | 'Task' | 'Bug';
  status: string;
  description: string;
  label: CastLabel;
  /** The person who owns it, or null when nobody does. A live demo site has
   *  one account, so reset-atlassian gives every assigned issue to whoever
   *  runs it. */
  assignee: string | null;
  /** ANCHOR-relative dates, YYYY-MM-DD. A mirror's `remote_updated` wins over
   *  `updated` when the fixture is built, because the mirror is what the demo
   *  shows before the first sync. */
  created: string;
  updated: string;
  /** Seeded oldest-first after wiping the live thread. */
  comments?: CastComment[];
  /** The SUMMARY of the epic this one hangs under, resolved to a live key at
   *  run time, because the site mints its own. */
  parent?: string;
}

// The star + supporting cast (vault-dev/tickets/jira/). Anything the demo
// CREATES live is deliberately absent, which is exactly why this script deletes
// non-cast issues again on reset.
export const CAST: CastIssue[] = [
  {
    key: 'BOK-300',
    project: 'BOK',
    summary: 'No-show fees (epic)',
    label: 'no-show-fees',
    issueType: 'Epic',
    status: 'In Progress',
    assignee: 'Rebecca Holm',
    created: '2026-05-20',
    updated: '2026-07-13',
    description:
      'A restaurant with fees switched on takes a card when the guest books, and charges a fee ' +
      'when the guest does not turn up. The first release has one fee per restaurant, on ' +
      'bookings from the restaurant website and from Google. Card storage goes through PAY-190.',
    comments: [
      {
        author: 'Rebecca Holm',
        date: '2026-07-03',
        body:
          'Spike done (BOK-301). PAY-190 stores the card and gives us a token to charge later. ' +
          'No stories yet. I want them before sprint planning on 22 July.',
      },
    ],
  },
  {
    key: 'BOK-301',
    project: 'BOK',
    summary: 'Spike: store a card through PAY-190',
    label: 'no-show-fees',
    issueType: 'Task',
    status: 'Done',
    assignee: 'Rebecca Holm',
    parent: 'No-show fees (epic)',
    created: '2026-06-26',
    updated: '2026-07-03',
    description:
      'Find out whether PAY-190 can hold a card at booking and give us a token to charge days ' +
      'later, and what the Payments team needs from us to do it.',
  },
  {
    key: 'BOK-412',
    project: 'BOK',
    summary: 'Reminder SMS sent twice for Google bookings',
    label: 'reminders',
    issueType: 'Bug',
    status: 'Done',
    assignee: 'Amir Haddad',
    created: '2026-07-08',
    updated: '2026-07-17',
    description:
      'Guests who book through the Google button get the day-before reminder twice, once from ' +
      'the Google booking record and once from ours. Sjögatan reported it on 2026-06-24 and ' +
      'Pizzeria Napoli on 2026-06-26, both through support. Four tickets so far.',
    comments: [
      {
        author: 'Jonas Berg',
        date: '2026-07-08',
        body: 'Four support tickets so far, all Google bookings. The macro says we are looking into it.',
      },
      {
        author: 'Amir Haddad',
        date: '2026-07-17',
        body:
          'Fixed: one reminder per booking, whatever the source. Released in the 09:10 deploy on ' +
          '2026-07-17.',
      },
    ],
  },
  {
    key: 'BOK-260',
    project: 'BOK',
    summary: 'Waitlist (epic)',
    label: 'waitlist',
    issueType: 'Epic',
    status: 'In Progress',
    assignee: 'Rebecca Holm',
    created: '2026-05-20',
    updated: '2026-07-15',
    description:
      'A guest who finds no free table joins the waitlist, and the restaurant texts the first ' +
      'guest on it when a table frees. Q4, after no-show fees.',
  },
  {
    key: 'BOK-262',
    project: 'BOK',
    summary: 'Join the waitlist from the booking page',
    label: 'waitlist',
    issueType: 'Story',
    status: 'Done',
    assignee: 'Amir Haddad',
    parent: 'Waitlist (epic)',
    created: '2026-06-15',
    updated: '2026-07-10',
    description:
      'When the booking page has no free table for the time a guest asked for, it offers the ' +
      'waitlist instead: name, party size, phone number, and the window the guest can come in.',
  },
  {
    key: 'BOK-265',
    project: 'BOK',
    summary: 'Text the first guest on the waitlist when a table frees',
    label: 'waitlist',
    issueType: 'Story',
    status: 'In Progress',
    assignee: 'Rebecca Holm',
    parent: 'Waitlist (epic)',
    created: '2026-06-15',
    updated: '2026-07-15',
    description:
      'A cancellation frees a table, so the first guest on the waitlist for that window gets a ' +
      'text with a link to take it. The offer runs out after fifteen minutes and moves on.',
  },
  {
    key: 'BOK-520',
    project: 'BOK',
    summary: 'Group bookings (epic)',
    label: 'group-bookings',
    issueType: 'Epic',
    status: 'To Do',
    assignee: null,
    created: '2026-06-18',
    updated: '2026-06-18',
    description:
      'Parties over eight book a set menu and pay a deposit. It waits on PAY-210 (deposits), ' +
      'so Roadmap H2 says Q1 2027.',
  },
  {
    key: 'GST-77',
    project: 'GST',
    summary: '"Book a table" button on Google',
    label: 'booking-page',
    issueType: 'Story',
    status: 'Done',
    assignee: 'Amir Haddad',
    created: '2026-04-20',
    updated: '2026-05-12',
    description:
      "A guest books from the restaurant's Google listing instead of finding the website " +
      'first. The booking lands in the same list as every other one.',
    comments: [
      {
        author: 'Amir Haddad',
        date: '2026-05-12',
        body: 'Live for every restaurant. Switch it on under Settings, Booking channels.',
      },
    ],
  },
  {
    key: 'GST-140',
    project: 'GST',
    summary: 'Table areas on the booking page',
    label: 'booking-page',
    issueType: 'Story',
    status: 'Done',
    assignee: 'Amir Haddad',
    created: '2026-06-10',
    updated: '2026-07-14',
    description:
      'A restaurant names the areas it seats guests in, and a guest picks one when booking. ' +
      'An area with no free table for that time is shown as full.',
    comments: [
      {
        author: 'Amir Haddad',
        date: '2026-07-14',
        body:
          'Released. A restaurant names its areas (window, terrace, bar) and guests pick one ' +
          'when they book.',
      },
    ],
  },
  {
    key: 'GST-160',
    project: 'GST',
    summary: 'Booking page in Finnish',
    label: 'booking-page',
    issueType: 'Story',
    status: 'To Do',
    assignee: null,
    created: '2026-07-01',
    updated: '2026-07-01',
    description:
      'The booking page in Finnish, for the restaurants that asked for it. Same text as the ' +
      'Swedish page, translated once and kept in the same file.',
  },
  {
    key: 'PAY-190',
    project: 'PAY',
    summary: 'Store a card for a later charge',
    label: 'payments',
    issueType: 'Story',
    status: 'Done',
    assignee: 'Henrik Dahl',
    created: '2026-06-01',
    updated: '2026-06-30',
    description:
      'Take a card at booking, keep it with the acquirer, and hand back a token the booking ' +
      'side can charge days later. Nothing is charged here.',
  },
  {
    key: 'PAY-210',
    project: 'PAY',
    summary: 'Deposits: charge at booking, refund on cancellation',
    label: 'payments',
    issueType: 'Epic',
    status: 'In Progress',
    assignee: 'Henrik Dahl',
    created: '2026-06-18',
    updated: '2026-07-09',
    description:
      'A guest pays a deposit when the booking is made, and gets it back when the booking is ' +
      'cancelled in time. Planned for Q4.',
    comments: [
      {
        author: 'Henrik Dahl',
        date: '2026-07-09',
        body: 'Design started. No date yet: the refund path depends on the acquirer.',
      },
    ],
  },
];

// Issue links between cast members, by summary. Direction per Jira's model:
// the INWARD issue applies the type's outward description to the OUTWARD issue
// ("Deposits" blocks "Group bookings").
export const CAST_LINKS: { type: string; inward: string; outward: string }[] = [
  {
    type: 'Blocks',
    inward: 'Deposits: charge at booking, refund on cancellation',
    outward: 'Group bookings (epic)',
  },
];

// Canonical Confluence bodies come from the git-tracked mirrors so the
// load-bearing text (the roadmap lines the demo patches) is verbatim by
// construction. vault-dev/wikipages/confluence/ is the single source of truth.
export const PAGES = [
  { title: 'Roadmap H2', file: 'roadmap-h2.md' },
  { title: 'Changelog', file: 'changelog.md' },
];

// The fictional ids the canonical vault's static mirrors carry, mapped to the
// cast identity that owns them on the live site. Reconciliation rewrites these
// tokens (and the fake host) across the runtime vault.
export const STATIC_HOST = 'bord.atlassian.net';
/** Static key → cast summary, derived so the cast can never drift from it. */
export const STATIC_TICKETS: Record<string, string> = Object.fromEntries(
  CAST.map((m) => [m.key, m.summary]),
);
export const STATIC_PAGE_IDS: Record<string, string> = {
  '4521985': 'Roadmap H2',
  '4784129': 'Changelog',
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
