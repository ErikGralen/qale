import {
  basename,
  deriveSeriesSlug,
  flatMirrorPath,
  hasOtherAttendee,
  meetingPathForEvent,
  mirrorPath,
  mirrorSlug,
  parseMirrorRef,
  planMeetingMirror,
  retargetWikilinks,
  slugFromPath,
  slugify,
  STATE_CATEGORIES,
  type Frontmatter,
  type MirrorKind,
  type StateCategory,
  type SyncedCalendarEvent,
} from '@qale/domain';
import {
  collectFields,
  CONNECTOR_PROVIDERS,
  URL_FIELD_RE,
  type Connector,
  type ConnectorProvider,
  type ContainerFootprint,
  type ContainerKind,
  type EventChange,
  type ExternalContainer,
  type FetchLike,
  type ShallowChange,
} from '@qale/connectors';
import { conventionsSkill, parseRunnable } from '@qale/sessions';
import { isVaultBoundaryError, type IndexedNote, type UseCaseContext } from '@qale/application';
import type { OutboundContainer } from '@qale/agent';
import type { SyncItemRow, SyncStore } from '@qale/vault';
import type {
  AtRiskLinkDTO,
  ConnectionContainerDTO,
  ConnectionDTO,
  ConnectionHealth,
  ConnectResultDTO,
  ContainerRecommendationDTO,
  ExternalRefMetaDTO,
  ProviderDescriptorDTO,
  ShallowIndexItemDTO,
} from '@qale/ipc';
import type { SettingsService } from './settings-service.js';
import type { GoogleOAuthService } from './google-oauth-service.js';

/**
 * The sync engine (Area C): pulls followed containers on the scheduler tick,
 * keeps the shallow index current, and promotes anything the vault actually
 * links to a full mirror note. This file is the ONLY code path that writes
 * `ticket`/`wikipage` files — and, for calendar sync, the only writer of the
 * machine-owned fields on `meeting` notes (the ownership-split mirror).
 *
 * Hard rules (integration plan): reads are silent — no cards, no dialogs;
 * health is a quiet DTO field. Offline/expired keeps serving the mirror.
 *
 * Every connection comes from the connector registry: one per registered
 * provider, keyed by its id, and all state is per-connection. Nothing here
 * names a provider except the OAuth exception in `credentialFor`.
 */

/**
 * Might this token be a ticket key at all ("PAY-142")? A cheap syntactic gate,
 * never an address (PD-11): Linear keys are Jira-shaped, so which tracker holds
 * a key is a lookup by id, and the shape only says the lookup is worth making.
 */
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

/** Local data older than this shows the quiet stale indicator on chips. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** Ceiling on tickets auto-tracked because they block something we hold. High
 *  enough that a real dependency web fits, low enough that one pathological
 *  epic can't quietly become the sync's whole job. */
const BLOCKER_TRACK_CAP = 100;

const GOOGLE_PROVIDER = 'google-calendar';

/** Stamped in the store once the flat mirrors have moved under their provider
 *  folder (PD-10). Set only after a clean pass, so a crash halfway resumes. */
const MIRROR_PATHS_MIGRATED = 'mirror-paths-migrated';

/**
 * How often the drift check looks for new containers worth offering
 * (docs/product-understanding.md FL-3). Weekly: the survey costs real requests,
 * and a space that appeared this morning is not urgent by lunchtime.
 */
const DRIFT_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** When one connection's drift check last ran, in the store beside the follows. */
const driftCheckKey = (connectionId: string): string => `drift-check:${connectionId}`;

/** A container the drift check thinks is worth one quiet question. */
export interface ContainerOffer {
  connectionId: string;
  containerId: string;
  kind: 'ticket' | 'wikipage' | 'calendar';
  name: string;
  /** Why it is worth asking about, in the same words the connect card uses. */
  reason?: string;
}

/** Where a pending offer's reason line is kept, so the question can be raised
 *  weeks later without re-running the survey to remember why. */
const offerReasonKey = (connectionId: string, containerId: string): string =>
  `offer-reason:${connectionId}:${containerId}`;

/**
 * How far one connection has got through the first look
 * (docs/first-look-debrief.md): `ready` once its first read finished and
 * nothing has been said about it yet, `done` once a session has been handed it.
 *
 * In the store rather than in memory, because the read usually finishes on a
 * tick nobody is waiting for and the session that reports it starts on the next
 * maintenance pass, which can be after a relaunch. A key that is absent means
 * this connection has never finished a first read, and that is also what every
 * workspace connected before this existed reads as: their containers already
 * carry a `last_sync`, so the check below never arms.
 */
type FirstLookState = 'ready' | 'done';
const firstLookKey = (connectionId: string): string => `first-look:${connectionId}`;

/** What one connection read the first time, as the debrief session is told it. */
export interface FirstLookRead {
  connectionId: string;
  /** What the connector calls itself ("Jira + Confluence"), from the registry. */
  providerLabel: string;
  /** The site or account, for the one line that names what was read. */
  siteLabel: string;
  containers: {
    id: string;
    kind: string;
    name: string;
    count: number;
    /**
     * The domain provider this container's items mirror ("jira", "confluence"),
     * from the connector. It is what says which conventions file the write-up
     * below belongs in, so a second tracker lands in its own file rather than in
     * Jira's. Absent for a kind the connector mirrors nowhere.
     */
    provider?: string;
  }[];
}

/**
 * Who the PM is, so the first read can tell their own tickets from the team's
 * (docs/learning-how-you-work.md, ticket 3). The name is the one from
 * Settings → You; the addresses are every one that means them.
 */
export interface FirstLookSelf {
  name: string | null;
  emails: string[];
}

/** One style file the first look writes, and what it is written from. */
interface ConventionsJob {
  /** The name that addresses it: `jira`, `confluence`. */
  name: string;
  path: string;
  /** What the file is called on screen ("How you write tickets"). */
  title: string;
  /** The one line under the title, quoted so the file reads the same either way. */
  summary: string;
  /** The `##` headings of the shipped template, in file order. */
  headings: string[];
  /** The containers it is written from, named the way the rows above name them. */
  from: string[];
  /** The container ids, for the query. */
  ids: string[];
}

/**
 * What the first look writes down about how the PM writes
 * (docs/learning-how-you-work.md, tickets 3 to 5).
 *
 * Every PM has a way of writing a ticket: which issue type for what, how a
 * title reads, how the description is laid out, which labels mean what. The
 * workspace could only learn it by being told, one rule at a time, so most
 * workspaces never learned it at all. A connection's first read is the one
 * moment the evidence is all there, so the file is written then, from the PM's
 * own last thirty tickets and their own recent pages.
 *
 * The headings and the title are quoted from the shipped template rather than
 * typed again here: the file has to land in the shape the template keeps, and
 * two copies of those headings would drift the first time one is renamed. What
 * each heading holds is said in {@link SECTION_GUIDES}, keyed by the heading,
 * so a renamed heading is loud in the tests rather than silent in the kickoff.
 *
 * A container the connector mirrors nowhere, an empty one, and a kind with no
 * style file (a calendar) all drop out, so a Google-only first look says
 * nothing about it.
 */
function conventionsJobs(reads: FirstLookRead[]): ConventionsJob[] {
  const jobs = new Map<string, ConventionsJob>();
  for (const read of reads) {
    for (const container of read.containers) {
      if (container.count === 0 || !container.provider) continue;
      const skill = conventionsSkill(container.provider);
      if (!skill) continue;
      const shipped = parseRunnable(skill.template, skill.name);
      const job = jobs.get(skill.name) ?? {
        name: skill.name,
        path: `skills/${skill.name}/SKILL.md`,
        title: shipped.title,
        summary: shipped.summary,
        headings: [...skill.template.matchAll(/^## (.+)$/gm)].map((m) => m[1]!.trim()),
        from: [],
        ids: [],
      };
      job.from.push(`${container.name} (${container.id})`);
      job.ids.push(container.id);
      jobs.set(skill.name, job);
    }
  }
  return [...jobs.values()];
}

/**
 * How each system is read: the PM's own work, newest first. The connection is
 * signed in as them, so `currentUser()` means them in both query languages.
 */
const READ_PLANS: Record<string, (ids: string[]) => string> = {
  jira: (ids) =>
    [
      `Search with \`jira_search\`: \`(assignee = currentUser() OR reporter = currentUser()) AND project in (${ids.join(', ')}) ORDER BY updated DESC\`.`,
      'Take the first thirty. Open ten of them in full with `jira_get_issue`, newest first.',
    ].join(' '),
  confluence: (ids) =>
    [
      `Search with \`confluence_search\`: \`type = page AND (creator = currentUser() OR contributor = currentUser()) AND space in (${ids.join(', ')}) ORDER BY lastmodified DESC\`.`,
      'Take about ten. Open five of them in full with `confluence_get_page`.',
    ].join(' '),
};

/**
 * What each section of a style file holds, keyed by the template's heading.
 * The kickoff walks the template's headings in file order and reads the guide
 * for each, so the file lands in the shape the template keeps.
 */
const SECTION_GUIDES: Record<string, string> = {
  'When you draft a ticket':
    'which issue type for what, how a title reads, how the description is laid out with one worked ' +
    'example copied from a real ticket and its key cited, and which fields they fill and which stay ' +
    'empty (assignee, parent, priority, components).',
  Labels:
    'one line per label seen, what it seems to mean, and how many tickets carried it. A label you ' +
    'cannot explain gets "(not sure yet)".',
  'When you comment':
    "how their comments read. `jira_get_issue` returns no comments, so keep the template's example " +
    'line unless you have read some.',
  'How a page is laid out':
    'which headings repeat, how long a page runs, and one worked example cited by page title and id.',
  'When you update a page':
    'how they make a change, adding under the headings that are there or rewriting the page, from ' +
    'what the pages show.',
  'Standing instructions': 'last, and only its one line. Rules they state later land there.',
};

/** The line under the title, per system: what it was read from, when, and that it is a guess. */
const FIRST_LINES: Record<string, (from: string) => string> = {
  jira: (from) =>
    `"Read from your last thirty tickets in ${from} on <today's date>. A guess from your tickets, not a ` +
    'rule you gave me. Change any line and I draft the new way from the next ticket on."',
  confluence: (from) =>
    `"Read from your last ten pages in ${from} on <today's date>. A guess from your pages, not a rule ` +
    'you gave me. Change any line and I draft the new way from the next page on."',
};

/** Who "you" is in the kickoff, when Settings → You says. */
function selfLine(self: FirstLookSelf | undefined): string {
  if (!self) return '';
  const who = [self.name, ...self.emails].filter((x): x is string => !!x);
  if (who.length === 0) return '';
  return ` They are ${who.join(', ')}: a reporter, an assignee or an author with that name or address is them.`;
}

/**
 * The style half of the kickoff: read the PM's own recent work and write down
 * how they write, one file per system, with no card.
 *
 * It is in the kickoff rather than in the skill, which is the one place this
 * instruction departs from "facts only" below. This job is not the interview:
 * it runs whether or not the PM wants a walkthrough, it ends in a file rather
 * than in a conversation, and only the caller knows a connection has just
 * arrived with nothing written about it. The file is the durable copy, and the
 * PM edits that.
 *
 * Three rules from docs/learning-how-you-work.md are doing real work here.
 * Never ask the PM for an example: thirty tickets say more than any question.
 * At most one question per system, and only about something seen and not
 * explained. And the file lands without a card (the domain policy's style-file
 * row), so the debrief opens with a link to it rather than with a card to
 * approve.
 */
function conventionsBlock(jobs: ConventionsJob[], self?: FirstLookSelf): string[] {
  if (jobs.length === 0) return [];
  const rows = jobs.map((job) => {
    const plan = READ_PLANS[job.name]?.(job.ids) ?? "Search with the connection's own tools.";
    const firstLine = FIRST_LINES[job.name]?.(job.ids.join(', ')) ?? '';
    const sections = job.headings.map(
      (h) => `"${h}": ${SECTION_GUIDES[h] ?? 'as the template shows.'}`,
    );
    return [
      `- \`${job.path}\`, written from ${job.from.join(' and ')}. ${plan}`,
      `Frontmatter: \`type: skill\`, \`title: ${job.title}\`, \`summary: ${job.summary}\`.`,
      `The line under the title says what it was read from, when, and that it is a guess: ${firstLine}`,
      `Then the sections, with these headings in this order. ${sections.join(' ')}`,
    ].join(' ');
  });
  const systems = jobs.map((job) => job.name).join(' and ');
  // The example cites the PM's own project, so it reads as their tickets and
  // not as somebody else's.
  const key = jobs.find((job) => job.name === 'jira')?.ids[0] ?? jobs[0]?.ids[0] ?? 'NORD';
  return [
    [
      'Before the knock, write down how they write their tickets and pages. Do this whether or not they',
      'want a walkthrough. Beat one says to propose nothing; this is the exception, and the only one.',
      'Read `skills/writing-skills/SKILL.md` first: it says how Qale writes into a file like this.',
    ].join(' '),
    [
      "Read their own work, not the team's. The connection is signed in as them, so `currentUser()` in a",
      `query means them.${selfLine(self)} If fewer come back than asked for, read what there is and say so`,
      'in the first line of the file: "Only four recent tickets were written here, so this is thin. I kept',
      'it short and I will ask when a draft needs more." If almost none are theirs, run the same query',
      "without the `currentUser()` clause, read the team's newest instead, and say so in the first line:",
      '"Almost none of these were written by you, so this is how your team writes them."',
    ].join(' '),
    'One file per system, a template you fill from what you read. Only what you can see in it:',
    rows.join('\n'),
    [
      'Write each file whole with `propose_note` and `inference: true`. It lands without a card: it is',
      "Qale's own notes about how they work, and the file is the record. If the file is already there",
      'and its first line says nothing was read yet, fill the sections with `propose_update` and leave',
      '"Standing instructions" as it is. If it already holds a real read, leave it alone.',
    ].join(' '),
    [
      'When the debrief opens (beat two, or the whole session when the picture is already there), start',
      'with the link to the file, then what you found, with a ticket or a page cited on every line: "I read',
      `your last thirty tickets in ${key} and wrote down how you write them: [[skills/jira/SKILL]]. Stories`,
      'start with one sentence about what a user cannot do today, then acceptance criteria as a checklist',
      `(${key}-214). Bugs get steps and the app version (${key}-198). This is a guess from your tickets, not a`,
      'rule you gave me. Change any line and I draft the new way from the next ticket on."',
    ].join(' '),
    [
      `Then at most one \`ask_user\` question per system (${systems}), and only about something you saw and`,
      'could not explain: a label on some tickets and not others, a field that is sometimes set. Put the',
      'count in the question, give two or three options, and make "Stop using it" one of them; they can',
      'always write their own answer beside the options. "Nine of your NORD stories carry the label',
      '`needs-legal` and the rest do not. I can see when you add it, but not why. What does it tell you?"',
      'The answer becomes one line in the file: call `propose_instruction` with `target: jira` (or',
      '`confluence`) and the answer as the rule. "Stop using it" writes "Do not add `needs-legal` to',
      'drafts". If everything you saw is explained, ask nothing. Never ask them to paste an example, and',
      'never ask about how they write one rule at a time. The question waits if they close the app.',
    ].join(' '),
  ];
}

/** What one container holds, said in the reader's words rather than the
 *  index's. Singular and plural, because "1 tickets" reads as a bug. */
const KIND_WORDS: Record<string, [string, string]> = {
  ticket: ['ticket', 'tickets'],
  wikipage: ['page', 'pages'],
  calendar: ['event', 'events'],
};

function itemWords(kind: string, count: number): string {
  const words = KIND_WORDS[kind] ?? ['item', 'items'];
  return `${count} ${count === 1 ? words[0] : words[1]}`;
}

/**
 * What the debrief session is handed (docs/first-look-debrief.md). Facts first:
 * which site, which containers, and how much is in each. What to DO with them
 * is the skill's own "First look" section, which the PM can read and edit, so
 * this names the section rather than repeating it.
 *
 * The style write-up is the one job stated here (docs/learning-how-you-work.md
 * ticket 3). See {@link conventionsBlock} for why it is not in the skill. `self`
 * is who the PM is, so the read can tell their tickets from the team's.
 *
 * It takes every read that is owed, not one (CM-5). Two connections made in the
 * same onboarding are one haul to the PM, and two knocks would be the app asking
 * the same opening question twice in five minutes.
 *
 * `told` is the one fact that changes the shape of the session: the workspace
 * has already been told about the product, so the report is the whole of it and
 * the interview would be asking again for what is written down. It arrives as a
 * line here rather than as a gate in the caller, because a workspace that has
 * heard the pitch still deserves to hear what its new connection just read
 * (2026-08-31).
 */
export function firstLookInstruction(
  reads: FirstLookRead[],
  told = false,
  self?: FirstLookSelf,
): string {
  const blocks = reads.map((read) => {
    const rows = read.containers
      .filter((c) => c.count > 0)
      .map((c) => `- ${c.name} (${c.id}): ${itemWords(c.kind, c.count)}`);
    return [`The ${read.providerLabel} connection on ${read.siteLabel}:`, ...rows].join('\n');
  });
  return [
    reads.length === 1
      ? 'A connection has finished its first read, and nothing has been said about it yet.'
      : `${reads.length} connections have finished their first read, and nothing has been said about them yet.`,
    'What is in the index now:',
    blocks.join('\n\n'),
    'This is a first look. Follow the "First look" section of the skill, and the topic is the product.',
    ...(told ? ['The workspace already holds the product picture, so skip the interview.'] : []),
    ...conventionsBlock(conventionsJobs(reads), self),
  ].join('\n\n');
}

/** Changes whenever any stored field changes, which is when a connector has to
 *  be rebuilt. Held in memory only, like the credentials it is built from. */
function fingerprintOf(fields: Record<string, string>): string {
  return Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('|');
}

/** The site handle a Settings row shows: the address the person pasted, without
 *  its scheme. A provider with no address field has only its own name to show. */
function siteLabelFor(fields: Record<string, string>, fallback: string): string {
  const url = Object.entries(fields).find(([key]) => URL_FIELD_RE.test(key))?.[1];
  return url ? url.replace(/^https?:\/\//, '') : fallback;
}

/** Provider timestamps arrive in several ISO dialects; the domain schema wants
 *  one. Unparseable input falls back to `now` — a mirror must never be invalid. */
function normalizeIso(value: string | undefined, nowMs: number): string {
  const parsed = value ? Date.parse(value) : NaN;
  return new Date(Number.isNaN(parsed) ? nowMs : parsed).toISOString();
}

function isStateCategory(v: unknown): v is StateCategory {
  return typeof v === 'string' && (STATE_CATEGORIES as readonly string[]).includes(v);
}

/** The tracker a mirror note names in its own frontmatter. */
function noteProvider(note: IndexedNote): string | null {
  const provider = (note.frontmatter as Record<string, unknown>)['provider'];
  return typeof provider === 'string' && provider ? provider : null;
}

/**
 * One id, two trackers: the reference names no item, so the chip says which
 * trackers hold it and the click goes nowhere (PD-11). Opening one of them
 * would be a guess, and the wrong ticket reads exactly like the right one.
 * Every field below the flag is a placeholder no ambiguous surface reads.
 */
function ambiguousMeta(
  key: string,
  kind: MirrorKind,
  providers: readonly string[],
): ExternalRefMetaDTO {
  return {
    kind,
    externalId: key,
    slug: key,
    title: key,
    containerName: '',
    url: '',
    remoteUpdated: new Date(0).toISOString(),
    syncedAt: 0,
    stale: false,
    health: 'ok',
    notePath: null,
    ambiguousProviders: [...providers].sort(),
  };
}

/** A synced meeting note surfaced from the shallow event index (agenda reads). */
export interface AgendaMeeting {
  notePath: string;
  title: string;
  startMs: number;
  endMs: number;
  cancelled: boolean;
  /** Someone other than the PM is on it. Solo blocks get notes like anything
   *  else, but they aren't a meeting to prepare for. */
  withOthers: boolean;
}

/** What the vault links, per tick — the deep-sync and harvest work list. */
interface DeepTargets {
  /** Every ticket key the vault names, however it is addressed. The deep test:
   *  a mirror is worth writing when the vault mentions its key at all. */
  ticketKeys: Set<string>;
  /** Keys written without a tracker: `[[PAY-142]]`, or a flat pre-PD-10 slug. */
  bareTicketKeys: Set<string>;
  /** Keys written against one tracker, by the provider they name. */
  keysByProvider: Map<string, Set<string>>;
  pageSlugs: Set<string>;
}

/** Per-connection runtime state; credentials live in settings, data in the store. */
interface ConnectionState {
  /** The registry entry this connection belongs to. */
  provider: ConnectorProvider<unknown>;
  connector: Connector | null;
  fingerprint: string | null;
  health: ConnectionHealth;
  identity: string | undefined;
  /** What the connection points at, as the Settings row shows it. */
  siteLabel: string;
}

const freshState = (provider: ConnectorProvider<unknown>): ConnectionState => ({
  provider,
  connector: null,
  fingerprint: null,
  health: 'ok',
  identity: undefined,
  siteLabel: provider.label,
});

export class SyncService {
  /** One connection per registered provider, keyed by the provider id. */
  private readonly conns = new Map<string, ConnectionState>();
  private inFlight: Promise<void> | null = null;
  /** Bare keys already reported as unclaimable, so the tick stays quiet. */
  private readonly warnedKeys = new Set<string>();

  constructor(
    private readonly getContext: () => UseCaseContext | null,
    private readonly getStore: () => SyncStore | null,
    private readonly settings: SettingsService,
    private readonly oauth: GoogleOAuthService,
    /** Fired after a tick that changed anything (mirror paths, or [] for
     *  connection-state-only changes) — pushes vault + connections events. */
    private readonly onChanged: (mirrorPaths: string[]) => void,
    /** The connector registry. A parameter so a test can register its own. */
    private readonly registry: readonly ConnectorProvider<unknown>[] = CONNECTOR_PROVIDERS,
    /** The transport a provider's connector gets. The demo build returns the
     *  fake Atlassian and the fake Google Calendar here, so nothing leaves the
     *  process (docs/demo-mode.md DM-8). Absent, every connector uses the
     *  global fetch. */
    private readonly fetchImplFor?: (providerId: string) => FetchLike | undefined,
  ) {
    for (const provider of registry) this.conns.set(provider.id, freshState(provider));
  }

  /** Rebuild connectors when credentials change; cheap to call every time. */
  reconfigure(): void {
    for (const state of [...this.conns.values()]) {
      const credential = this.credentialFor(state.provider);
      if (credential.fingerprint === state.fingerprint) continue;
      const { create, ...rest } = credential;
      this.conns.set(state.provider.id, {
        ...freshState(state.provider),
        ...rest,
        connector: create(),
      });
    }
  }

  /**
   * What is stored for one provider, as the connection is built from it. The
   * fingerprint is compared before `create` is called, so a reconfigure that
   * changes nothing costs one settings read and no connector.
   *
   * Google is the exception, and the only one: its credential is a browser
   * grant in its own settings slot, and its connector takes a live-token
   * callback rather than pasted fields. Every other provider builds from the
   * credential map, and this method is the single place that knows the
   * difference.
   */
  private credentialFor(provider: ConnectorProvider<unknown>): {
    fingerprint: string | null;
    identity: string | undefined;
    siteLabel: string;
    create: () => Connector | null;
  } {
    if (provider.id === GOOGLE_PROVIDER) {
      const google = this.settings.getGoogle();
      return {
        fingerprint: google ? `grant|${google.refreshToken.slice(0, 12)}` : null,
        identity: google?.email ?? undefined,
        siteLabel: google?.email ?? 'Google account',
        create: () => {
          if (!google) return null;
          // The demo build answers the calendar from a fixture, the same seam
          // Jira and Confluence use below (docs/demo-mode.md).
          const fetchImpl = this.fetchImplFor?.(provider.id);
          return provider.create(
            { getAccessToken: () => this.oauth.getAccessToken() },
            fetchImpl ? { fetchImpl } : undefined,
          );
        },
      };
    }
    const stored = this.settings.getConnection(provider.id);
    const fields = stored ? collectFields(provider, stored.fields) : null;
    const parsed = fields ? provider.authSchema.safeParse(fields) : null;
    return {
      fingerprint: fields ? fingerprintOf(fields) : null,
      identity: undefined,
      siteLabel: fields ? siteLabelFor(fields, provider.label) : provider.label,
      create: () => {
        if (!parsed?.success) return null;
        const fetchImpl = this.fetchImplFor?.(provider.id);
        return provider.create(parsed.data, fetchImpl ? { fetchImpl } : undefined);
      },
    };
  }

  /** The settings form renders from this. Every entry comes from the connector
   *  registry, so a new connector needs no edit here. */
  providers(): ProviderDescriptorDTO[] {
    return this.registry.map((p) => ({
      id: p.id,
      label: p.label,
      fields: p.authFields.map((f) => ({ ...f })),
      renewFieldKeys: [...p.renewFieldKeys],
      ...(p.authKind ? { authKind: p.authKind } : {}),
    }));
  }

  /** Connection list for Settings — store-backed, never hits the network. */
  list(): ConnectionDTO[] {
    this.reconfigure();
    const out: ConnectionDTO[] = [];
    for (const state of this.conns.values()) {
      if (state.connector) out.push(this.connectionDto(state));
    }
    return out;
  }

  private connectionDto(state: ConnectionState): ConnectionDTO {
    const store = this.getStore();
    const id = state.provider.id;
    const containers: ConnectionContainerDTO[] = (store?.listContainers(id) ?? []).map((c) => ({
      id: c.containerId,
      kind: c.kind,
      name: c.name,
      followed: c.followed,
      lastSync: c.lastSync,
      itemCount: store?.countByContainer(id, c.containerId),
      // The folder this container's mirrors land in ("jira", "confluence").
      // The connector answers it, so the rail gets a row per system without
      // hardcoding one (docs/memory-placement.md).
      provider: state.connector?.providers[c.kind as ContainerKind] ?? undefined,
    }));
    const lastSync = containers.reduce<number | null>(
      (acc, c) => (c.lastSync !== null && (acc === null || c.lastSync > acc) ? c.lastSync : acc),
      null,
    );
    return {
      id,
      providerId: id,
      providerLabel: state.provider.label,
      siteLabel: state.siteLabel,
      ...(state.identity ? { identity: state.identity } : {}),
      health: state.health,
      lastSync,
      containers,
    };
  }

  /** Validate + verify + persist credentials, then refresh containers. */
  async connect(connectionId: string, values: Record<string, string>): Promise<ConnectResultDTO> {
    // The OAuth exception: there is no form to validate, the browser flow is
    // the credential. See credentialFor.
    if (connectionId === GOOGLE_PROVIDER) return this.connectGoogle();
    const state = this.conns.get(connectionId);
    if (!state) {
      return { ok: false, health: 'unreachable', error: 'Unknown provider.' };
    }
    const fields = collectFields(state.provider, values);
    const parsed = state.provider.authSchema.safeParse(fields);
    if (!parsed.success) {
      return {
        ok: false,
        health: 'auth-expired',
        error: 'Check the site URL, email and API token. One of them is missing or malformed.',
      };
    }
    const probe = state.provider.create(parsed.data);
    const verify = await probe.verifyAuth();
    if (!verify.ok) {
      return {
        ok: false,
        health: verify.health,
        error:
          verify.error ??
          (verify.health === 'auth-expired'
            ? 'The credentials were rejected. Paste a fresh token and try again.'
            : "Couldn't reach the site. Check the URL and your connection."),
      };
    }
    await this.settings.setConnection(connectionId, state.provider.id, fields);
    state.fingerprint = null; // force rebuild on next call
    this.reconfigure();
    const built = this.conns.get(connectionId)!;
    built.health = 'ok';
    built.identity = verify.identity?.displayName;
    await this.refreshContainers(connectionId).catch(() => {});
    this.onChanged([]);
    return {
      ok: true,
      health: 'ok',
      ...(built.identity ? { identity: built.identity } : {}),
      siteLabel: built.siteLabel,
      connection: this.list().find((c) => c.id === connectionId),
    };
  }

  /**
   * Google connect: the browser round-trip (loopback + PKCE), then the same
   * verify-and-persist shape a pasted credential gets. No calendar is followed
   * by default — the PM picks which ones to mirror from the Connections list.
   */
  private async connectGoogle(): Promise<ConnectResultDTO> {
    try {
      await this.oauth.connect();
    } catch (err) {
      return {
        ok: false,
        health: 'unreachable',
        error: err instanceof Error ? err.message : 'Google sign-in didn’t complete.',
      };
    }
    this.conns.get(GOOGLE_PROVIDER)!.fingerprint = null;
    this.reconfigure();
    const state = this.conns.get(GOOGLE_PROVIDER)!;
    const verify = await state.connector!.verifyAuth();
    if (!verify.ok) {
      state.health = verify.health;
      return {
        ok: false,
        health: verify.health,
        error: verify.error ?? 'Google connected but the calendar probe failed — try again.',
      };
    }
    state.health = 'ok';
    state.identity = verify.identity?.email ?? verify.identity?.displayName;
    if (verify.identity?.email) await this.settings.setGoogleEmail(verify.identity.email);

    // Populate the calendar catalogue; nothing is followed by default — the PM
    // picks which calendars to mirror from the Connections list.
    await this.refreshContainers(GOOGLE_PROVIDER).catch(() => {});
    void this.tick().catch(() => {});
    this.onChanged([]);
    return {
      ok: true,
      health: 'ok',
      ...(state.identity ? { identity: state.identity } : {}),
      siteLabel: state.identity ?? 'Google account',
      connection: this.list().find((c) => c.id === GOOGLE_PROVIDER),
    };
  }

  /** The calm expired path. Field auth: merge the re-pasted secret over the
   *  stored creds. Google: re-run the browser flow. Follows and marks survive. */
  async renewAuth(connectionId: string, values: Record<string, string>): Promise<ConnectResultDTO> {
    if (connectionId === GOOGLE_PROVIDER) return this.connectGoogle();
    const stored = this.conns.has(connectionId) ? this.settings.getConnection(connectionId) : null;
    if (!stored) {
      return { ok: false, health: 'unreachable', error: 'Nothing is connected yet.' };
    }
    return this.connect(connectionId, { ...stored.fields, ...values });
  }

  /** A pending Google browser flow the PM gave up on. */
  cancelOAuth(): void {
    this.oauth.cancel();
  }

  /** Disconnect clears the CREDENTIAL (the part that lies if it stays), keeps
   *  local data: mirrors, meeting notes and follows survive a reconnect. */
  async disconnect(connectionId: string): Promise<void> {
    const state = this.conns.get(connectionId);
    if (!state) return;
    // The OAuth exception: revoking a browser grant is the OAuth service's job.
    if (connectionId === GOOGLE_PROVIDER) await this.oauth.disconnect();
    else await this.settings.clearConnection(connectionId);
    this.conns.set(connectionId, freshState(state.provider));
    this.onChanged([]);
  }

  async setFollow(connectionId: string, containerId: string, followed: boolean): Promise<void> {
    if (!this.conns.has(connectionId)) return;
    this.getStore()?.setFollow(connectionId, containerId, followed);
    this.onChanged([]);
    // A newly-followed container syncs right away — the picker feels live.
    if (followed) void this.tick().catch(() => {});
  }

  /**
   * What this connection should read, in the order a person should meet it
   * (docs/product-understanding.md FL-2). The connector surveys where they
   * actually work; this turns each row into the one line that makes the
   * recommendation checkable ("you edited 12 pages here, last one on Tuesday").
   *
   * Never throws and never blocks anything: a provider without a survey, a
   * survey that fails, and a brand-new hire with no footprint all come back as
   * an empty list, and the picker falls back to the flat catalogue.
   */
  async recommend(connectionId: string): Promise<ContainerRecommendationDTO[]> {
    this.reconfigure();
    const connector = this.conns.get(connectionId)?.connector;
    if (!connector?.surveyFootprint) return [];
    let footprint: ContainerFootprint[];
    try {
      footprint = await connector.surveyFootprint();
    } catch (err) {
      console.error(
        '[qale] sync: footprint survey failed:',
        err instanceof Error ? err.message : err,
      );
      return [];
    }
    // Only containers the catalogue actually holds: a project the survey names
    // but the picker cannot show is a row nobody could tick.
    const known = new Set(
      (this.getStore()?.listContainers(connectionId) ?? []).map((c) => c.containerId),
    );
    return footprint
      .filter((f) => f.count > 0 && known.has(f.id))
      .map((f) => ({ id: f.id, kind: f.kind, reason: footprintReason(f) }));
  }

  // -------------------------------------------------------------------------
  // The drift check (docs/product-understanding.md FL-3)
  // -------------------------------------------------------------------------

  /**
   * Spaces and projects that turned up since the last check and are full of
   * this person's own work. One quiet question each, carried by the librarian.
   *
   * Three rules, all of them about not being a nag:
   *
   * - **Weekly, not every tick.** The survey costs real requests against their
   *   rate limit, and a new space does not become urgent in five minutes.
   * - **No footprint, no question.** A space the PM has never touched is not
   *   news, however new it is. This is what keeps a big instance quiet.
   * - **The first check only sets the baseline.** Without that, connecting a
   *   site would make every space on it "new", and the first pass would ask
   *   about forty of them.
   *
   * The offer lives on the container row rather than in memory, so a pending
   * question survives a quit, and an answered one is answered for good. Returns
   * everything still pending — including offers raised on an earlier tick that
   * no session has carried yet.
   */
  async containerOffers(now = Date.now()): Promise<ContainerOffer[]> {
    const store = this.getStore();
    if (!store) return [];
    this.reconfigure();
    const out: ContainerOffer[] = [];
    for (const [connectionId, state] of this.conns) {
      // The check IS the footprint survey. A connector without one can never
      // mark anything pending, so there is nothing to run and nothing to
      // baseline — a calendar list is not a forty-space instance.
      if (!state.connector?.surveyFootprint) continue;
      const key = driftCheckKey(connectionId);
      const last = Number(store.getMeta(key));
      if (!Number.isFinite(last) || last === 0) {
        // First look: everything currently listed is the baseline, not news.
        store.setMeta(key, String(now));
        continue;
      }
      if (now - last >= DRIFT_CHECK_INTERVAL_MS) {
        store.setMeta(key, String(now));
        await this.markNewContainersPending(store, connectionId, last).catch((err) => {
          console.error(
            '[qale] sync: drift check failed:',
            err instanceof Error ? err.message : err,
          );
        });
      }
      for (const row of store.pendingOffers(connectionId)) {
        const reason = store.getMeta(offerReasonKey(connectionId, row.containerId));
        out.push({
          connectionId,
          containerId: row.containerId,
          kind: row.kind,
          name: row.name,
          ...(reason ? { reason } : {}),
        });
      }
    }
    return out;
  }

  /** The survey half of the drift check, run at most weekly. */
  private async markNewContainersPending(
    store: SyncStore,
    connectionId: string,
    since: number,
  ): Promise<void> {
    const fresh = store
      .listContainers(connectionId)
      .filter((c) => !c.followed && c.offerState === null && (c.firstSeen ?? 0) > since);
    if (fresh.length === 0) return;
    const connector = this.conns.get(connectionId)?.connector;
    if (!connector?.surveyFootprint) return;
    const footprint = await connector.surveyFootprint();
    const worked = new Map(footprint.filter((f) => f.count > 0).map((f) => [f.id, f]));
    for (const container of fresh) {
      const found = worked.get(container.containerId);
      if (!found) continue;
      store.setMeta(offerReasonKey(connectionId, container.containerId), footprintReason(found));
      store.setOfferState(connectionId, container.containerId, 'pending');
    }
  }

  /** The question has been put to the PM; it is never raised again from here. */
  markContainersOffered(containerIds: string[]): void {
    const store = this.getStore();
    for (const id of containerIds) {
      const connectionId = this.connectionForContainer(id);
      if (connectionId) store?.setOfferState(connectionId, id, 'offered');
    }
  }

  /**
   * What the PM said. Yes follows it through the ordinary path (which syncs it
   * immediately); no is remembered for good, so the container never comes back
   * round — the same posture as waving off a capture nudge.
   */
  async answerContainerOffer(containerId: string, follow: boolean): Promise<boolean> {
    const store = this.getStore();
    const connectionId = this.connectionForContainer(containerId);
    if (!store || !connectionId) return false;
    if (follow) {
      store.setOfferState(connectionId, containerId, null);
      await this.setFollow(connectionId, containerId, true);
    } else {
      store.setOfferState(connectionId, containerId, 'declined');
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // The first look (docs/first-look-debrief.md)
  // -------------------------------------------------------------------------

  /**
   * Connections that have finished their first read and have had nothing said
   * about them yet. One entry means one debrief session is owed.
   *
   * The counts are read back out of the store rather than counted during the
   * tick, so the numbers the session quotes are the numbers the workspace holds
   * at the moment it speaks, however long after the read that is.
   */
  firstLookReads(): FirstLookRead[] {
    const store = this.getStore();
    if (!store) return [];
    // For the site label: without this it falls back to the provider's own name
    // ("Jira + Confluence") rather than the site they actually connected.
    this.reconfigure();
    const out: FirstLookRead[] = [];
    for (const [connectionId, state] of this.conns) {
      if (store.getMeta(firstLookKey(connectionId)) !== 'ready') continue;
      const containers = store.followedContainers(connectionId).map((c) => ({
        id: c.containerId,
        kind: c.kind,
        name: c.name,
        count: store.countByContainer(connectionId, c.containerId),
        // Which conventions file this container's items would be drafted by
        // (E-25). The connector answers it, so a second tracker gets its own
        // file instead of writing into Jira's.
        provider: state.connector?.providers[c.kind as ContainerKind] ?? undefined,
      }));
      // Nothing read is nothing to report. It cannot happen on a clean first
      // pass over a project with work in it, and an empty site is not news.
      if (containers.every((c) => c.count === 0)) {
        store.setMeta(firstLookKey(connectionId), 'done' as FirstLookState);
        continue;
      }
      out.push({
        connectionId,
        providerLabel: state.provider.label,
        siteLabel: state.siteLabel,
        containers,
      });
    }
    return out;
  }

  /**
   * A session has been handed this read. Stamped BEFORE the run starts, the way
   * the meeting sweep stamps its ledger: the window between firing and the
   * question landing is exactly where a second tick would ask the same thing.
   */
  markFirstLookDone(connectionId: string): void {
    this.getStore()?.setMeta(firstLookKey(connectionId), 'done' as FirstLookState);
  }

  /** Which connection lists this container. An offer travels as a bare id (it
   *  passes through a session), so the owner is looked up, not carried. */
  private connectionForContainer(containerId: string): string | null {
    const store = this.getStore();
    for (const connectionId of this.conns.keys()) {
      if (store?.listContainers(connectionId).some((c) => c.containerId === containerId))
        return connectionId;
    }
    return null;
  }

  /** Pull a connection's container catalogue into the store (names refresh, follows kept). */
  async refreshContainers(connectionId: string): Promise<ExternalContainer[]> {
    this.reconfigure();
    const store = this.getStore();
    const connector = this.conns.get(connectionId)?.connector;
    if (!connector || !store) return [];
    const containers = await connector.listContainers();
    for (const c of containers) store.upsertContainer(connectionId, c.kind, c.id, c.name);
    return containers;
  }

  /**
   * One sync tick: for each followed container, incremental shallow pull →
   * upsert index → advance the high-water mark → deep-sync anything the vault
   * links. Reentrancy-guarded; a tick that overlaps the next is skipped, not
   * queued. Errors set the quiet health state and never escape.
   */
  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    this.reconfigure();
    const ctx = this.getContext();
    const store = this.getStore();
    if (!ctx || !store) return;

    const now = Date.now();
    const written: string[] = [];
    let anyChange = false;
    let anyFailed = false;

    // Before anything is pulled: a vault written before PD-10 has its mirrors
    // flat, and the writer below files new ones under a provider folder. Mixing
    // the two layouts is what this avoids.
    const migrated = await this.migrateMirrorPaths(ctx, store);

    for (const [connectionId, state] of this.conns) {
      const connector = state.connector;
      if (!connector) continue;

      // Refresh the catalogue every tick so calendars added (or renamed) in
      // Google since connect surface on their own — not just when it's empty.
      // upsertContainer keeps existing follow flags, so this only ever adds new
      // rows (unfollowed) and freshens names.
      await this.refreshContainers(connectionId).catch(() => {});
      const followed = store.followedContainers(connectionId);
      if (followed.length === 0) continue;

      // Is this the connection's very first read (docs/first-look-debrief.md)?
      // Nothing followed here has ever been pulled, so what lands in this pass
      // is everything the workspace knows about this site. Read BEFORE the pull
      // loop, because the loop is what makes it stop being true.
      //
      // "Never pulled" is the whole test, and it is what keeps this off every
      // workspace that already syncs: their containers carry a `last_sync`.
      // Following a second project months later is not a first read either, for
      // the same reason.
      const firstRead =
        !store.getMeta(firstLookKey(connectionId)) && followed.every((c) => c.lastSync === null);

      // Deep mirrors, promotion and tracking all hang off pulling an item by
      // its id. A connector that can't do that (a calendar) has none of them:
      // its items qualify by attendance, not by being linked.
      const holdsByKey = connector.pullByKeys != null;

      let failed = false;
      for (const container of followed) {
        try {
          const pulled = await connector.pullChanges(
            { kind: container.kind, id: container.containerId, name: container.name },
            container.highWater,
            { now },
          );
          const deep = holdsByKey ? this.deepTargets(ctx) : null;
          for (const change of pulled.changes) {
            anyChange = true;
            if (change.kind === 'event') {
              const path = await this.applyEvent(ctx, store, change);
              if (path) written.push(path);
            } else {
              store.upsertItem(shallowToRow(connectionId, change));
              if (deep && this.isDeep(connectionId, change, deep, store)) {
                const path = await this.writeMirror(ctx, store, connectionId, change, now);
                if (path) written.push(path);
              }
            }
          }
          store.setHighWater(connectionId, container.containerId, pulled.highWaterMark, now);
        } catch (err) {
          failed = true;
          console.error(
            `[qale] sync: pull failed for ${container.containerId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Promotion sweep: items linked from the vault since the last tick but
      // NOT changed upstream still deserve their mirror note (linking IS the
      // gesture).
      if (holdsByKey) {
        try {
          const deep = this.deepTargets(ctx);
          for (const kind of ['ticket', 'wikipage'] as const) {
            for (const row of store.itemsByKind(kind)) {
              if (row.provider !== connectionId) continue;
              if (row.notePath) continue;
              if (!this.isDeepRow(row, deep)) continue;
              const path = await this.writeMirror(ctx, store, connectionId, rowToShallow(row), now);
              if (path) written.push(path);
            }
          }
        } catch (err) {
          console.error(
            '[qale] sync: promotion sweep failed:',
            err instanceof Error ? err.message : err,
          );
        }

        // Tracked pass: everything we hold by id rather than by container.
        try {
          const paths = await this.syncTracked(ctx, store, connectionId, now);
          if (paths.length > 0) {
            written.push(...paths);
            anyChange = true;
          }
        } catch (err) {
          console.error(
            '[qale] sync: tracked pull failed:',
            err instanceof Error ? err.message : err,
          );
        }
      }

      if (failed) {
        anyFailed = true;
        // Classify quietly: one probe tells expired-token apart from network-down.
        try {
          const verify = await connector.verifyAuth();
          state.health = verify.ok ? 'ok' : verify.health;
          state.identity = verify.identity?.displayName ?? state.identity;
        } catch {
          state.health = 'unreachable';
        }
      } else {
        state.health = 'ok';
      }

      // The first read is over. Arm the debrief, once, and only on a clean pass:
      // a container that failed still has no `last_sync`, so the next tick tries
      // again rather than reporting on half a site.
      if (firstRead && !failed)
        store.setMeta(firstLookKey(connectionId), 'ready' as FirstLookState);
    }

    if (written.length > 0) {
      await ctx.git
        .commitPaths(written, `sync: ${written.length} mirror${written.length === 1 ? '' : 's'}`)
        .catch(() => {});
    }
    if (anyChange || written.length > 0 || anyFailed || migrated.length > 0) {
      this.onChanged([...written, ...migrated]);
    }
  }

  // -------------------------------------------------------------------------
  // The one-time mirror move (PD-10)
  // -------------------------------------------------------------------------

  /**
   * Move every flat mirror (`tickets/PAY-142.md`) under the folder of the
   * provider that owns it (`tickets/jira/PAY-142.md`), rebind its sync row, and
   * follow the wikilinks that named the old path. One pass, one commit, and a
   * flag in the store when it is done.
   *
   * Three rules it shares with the rest of the engine:
   *
   * - **A file that is gone stays gone.** A bound path with no file means the PM
   *   deleted that mirror; recreating it here would be the same mistake the
   *   meeting patcher refuses to make.
   * - **A file with no row still moves.** A vault copied between machines has
   *   mirrors and no sync database, and the note's own `provider` field says
   *   which system it came from.
   * - **Resumable.** Moving an already-moved file is a no-op, and the flag is
   *   stamped at the end, so a crash halfway costs a second pass and nothing else.
   *
   * Returns the paths it touched (both ends of every move, plus the notes whose
   * links followed), so the tick can report them as changed.
   */
  private async migrateMirrorPaths(ctx: UseCaseContext, store: SyncStore): Promise<string[]> {
    const touched: string[] = [];
    try {
      if (store.getMeta(MIRROR_PATHS_MIGRATED)) return [];
      // Rows by the path they are bound to: that is how a moved file keeps its
      // row without a lookup per note.
      const rowByPath = new Map<string, SyncItemRow>();
      for (const kind of ['ticket', 'wikipage'] as const) {
        for (const row of store.itemsByKind(kind)) {
          if (row.notePath) rowByPath.set(row.notePath, row);
        }
      }

      const renamed = new Map<string, string>();
      for (const note of ctx.index.all()) {
        if (note.type !== 'ticket' && note.type !== 'wikipage') continue;
        const flat = flatMirrorPath(note.path);
        if (!flat) continue;
        const row = rowByPath.get(note.path) ?? null;
        const provider = this.mirrorProviderOf(note, row);
        if (!provider) {
          console.warn(`[qale] sync: ${note.path} names no provider — left where it is`);
          continue;
        }
        const to = mirrorPath(flat.kind, provider, flat.name);
        const externalId = String(note.frontmatter['external_id'] ?? '');
        if (!(await this.moveMirror(ctx, note.path, to, externalId))) continue;
        touched.push(note.path, to);
        renamed.set(note.slug.toLowerCase(), slugFromPath(to));
        if (row) store.setNotePath(row.provider, row.externalId, to);
      }

      touched.push(...(await this.retargetMirrorLinks(ctx, renamed)));
      if (touched.length > 0) {
        await ctx.git
          .commitPaths([...new Set(touched)], 'sync: migrate mirror paths')
          .catch(() => {});
      }
      store.setMeta(MIRROR_PATHS_MIGRATED, new Date().toISOString());
    } catch (err) {
      // No flag: the next tick picks up where this one stopped.
      console.error(
        '[qale] sync: mirror path migration failed:',
        err instanceof Error ? err.message : err,
      );
    }
    return touched;
  }

  /**
   * Which provider's folder a mirror belongs in. The connection that holds it
   * answers first (its connector says which provider string it stamps); a
   * connector nobody has credentials for cannot, so the note's own `provider`
   * field answers instead. Every mirror carries one.
   */
  private mirrorProviderOf(note: IndexedNote, row: SyncItemRow | null): string | null {
    const kind = note.type as MirrorKind;
    const mapped = row ? this.conns.get(row.provider)?.connector?.providers[kind] : null;
    if (mapped) return mapped;
    const declared = note.frontmatter['provider'];
    return typeof declared === 'string' && declared.trim() ? declared.trim() : null;
  }

  /** One move, through the vault so the watcher and the index stay coherent. */
  private async moveMirror(
    ctx: UseCaseContext,
    from: string,
    to: string,
    externalId: string,
  ): Promise<boolean> {
    const raw = await ctx.vault.readRaw(from);
    if (raw === null) return false;
    if (await ctx.vault.exists(to)) {
      // A crash between the write and the delete leaves both files; finishing
      // the move is the resume. Anything else sitting there is not ours to
      // overwrite, and a mirror we cannot place stays where it is.
      const there = await ctx.vault.readNote(to);
      const holder = String((there?.frontmatter as Record<string, unknown>)['external_id'] ?? '');
      if (!externalId || holder !== externalId) {
        console.warn(`[qale] sync: ${to} is taken — ${from} left where it is`);
        return false;
      }
    } else {
      await ctx.vault.writeRaw(to, raw);
    }
    await ctx.vault.remove(from);
    ctx.index.removeByPath(from);
    const moved = await ctx.vault.readNote(to);
    if (moved) ctx.index.reindex(moved);
    return true;
  }

  /**
   * Point the vault's `[[tickets/PAY-142]]` links at the path the file now has.
   * Only explicit path refs: a bare `[[PAY-142]]` names no folder, so nothing
   * about it went stale (PD-11 owns how those resolve).
   */
  private async retargetMirrorLinks(
    ctx: UseCaseContext,
    renamed: Map<string, string>,
  ): Promise<string[]> {
    if (renamed.size === 0) return [];
    const rewritten: string[] = [];
    for (const note of ctx.index.all()) {
      if (!note.links.some((l) => renamed.has(slugFromPath(l.target).toLowerCase()))) continue;
      const raw = await ctx.vault.readRaw(note.path);
      if (raw === null) continue;
      const next = retargetWikilinks(
        raw,
        (target) => renamed.get(slugFromPath(target).toLowerCase()) ?? null,
      );
      if (next === raw) continue;
      await ctx.vault.writeRaw(note.path, next);
      const written = await ctx.vault.readNote(note.path);
      if (written) ctx.index.reindex(written);
      rewritten.push(note.path);
    }
    return rewritten;
  }

  // -------------------------------------------------------------------------
  // The meeting mirror patcher (google-calendar): the ONLY writer of the
  // machine-owned fields on meeting notes. Decisions live in @qale/domain
  // (planMeetingMirror); this method resolves the note, applies the plan, and
  // keeps the shallow row + note_path binding true.
  // -------------------------------------------------------------------------

  private async applyEvent(
    ctx: UseCaseContext,
    store: SyncStore,
    change: EventChange,
  ): Promise<string | null> {
    try {
      // Cancellation arrives as a stub (id + status, little else) — merge over
      // the shallow row so the plan sees the event as we last knew it.
      const prior = store.itemByExternalId(GOOGLE_PROVIDER, change.external_id);
      const row = mergeEventRow(prior?.kind === 'event' ? prior : null, change);
      store.upsertItem(row);
      const event = rowToEvent(row);

      // Resolve the bound note. A note_path whose file is gone means the PM
      // deleted a synced note — that's a human gesture; never recreate it.
      let notePath = row.notePath;
      let note = notePath ? await ctx.vault.readNote(notePath) : null;
      if (!note) {
        // Adopt hand-written or restored notes that already carry this event id.
        // A bound path whose file vanished comes through here too: renaming a
        // meeting MOVES it, and without this the binding would read as a
        // deletion and that meeting would quietly stop syncing for good.
        const adopted = this.mirrorMeetingByExternalId(ctx, change.external_id);
        if (adopted) {
          notePath = adopted.path;
          note = await ctx.vault.readNote(adopted.path);
          store.setNotePath(GOOGLE_PROVIDER, change.external_id, adopted.path);
        } else if (notePath) {
          // Nothing in the vault carries this id any more: it really is gone.
          return null;
        }
      }

      const seriesSlug = row.recurringId
        ? store.seriesSlug(GOOGLE_PROVIDER, row.recurringId, () => deriveSeriesSlug(event))
        : undefined;
      const plan = planMeetingMirror({
        event,
        calendar: row.container,
        provider: GOOGLE_PROVIDER,
        ...(seriesSlug ? { seriesSlug } : {}),
        participants: resolveParticipants(ctx, event),
        existing: note
          ? { frontmatter: note.frontmatter as Record<string, unknown>, body: note.body }
          : null,
      });

      if (plan.action === 'skip') return null;
      if (plan.action === 'patch') {
        const written = await ctx.vault.writeNote(
          notePath!,
          plan.frontmatter as unknown as Frontmatter,
          note!.body,
        );
        ctx.index.reindex(written);
        return notePath!;
      }
      // create — uniquify the filename against unrelated same-day same-title notes.
      let path = meetingPathForEvent(event);
      for (let i = 2; i <= 9 && (await ctx.vault.exists(path)); i += 1) {
        path = meetingPathForEvent(event).replace(/\.md$/, `-${i}.md`);
      }
      const written = await ctx.vault.writeNote(
        path,
        plan.frontmatter as unknown as Frontmatter,
        '',
      );
      ctx.index.reindex(written);
      store.setNotePath(GOOGLE_PROVIDER, change.external_id, path);
      return path;
    } catch (err) {
      console.error(
        `[qale] sync: meeting mirror failed for ${change.external_id}:`,
        err instanceof Error ? err.message : err,
      );
      // Swallowed like the rest, a refused path would let the container's
      // high-water mark advance past an event that never landed: the meeting
      // would be missing for good and the connection would still read healthy.
      // Out to the pull loop instead, which leaves the mark where it is.
      if (isVaultBoundaryError(err)) throw err;
      return null;
    }
  }

  private mirrorMeetingByExternalId(ctx: UseCaseContext, externalId: string): IndexedNote | null {
    return (
      ctx.index
        .listByType('meeting')
        .find((n) => (n.frontmatter as Record<string, unknown>)['external_id'] === externalId) ??
      null
    );
  }

  /**
   * Everything the vault currently links that could name an external item:
   * ticket keys (bare `[[PAY-142]]` or `tickets/…` slugs) and wikipage refs
   * (`wikipages/…` slugs, or a link target whose slug matches a known page
   * title). Case-insensitive; recomputed per tick from the index.
   *
   * Ticket keys are split by how the link addresses them, because that decides
   * who may harvest them (PD-11). See {@link DeepTargets}.
   */
  private deepTargets(ctx: UseCaseContext): DeepTargets {
    const ticketKeys = new Set<string>();
    const bareTicketKeys = new Set<string>();
    const keysByProvider = new Map<string, Set<string>>();
    const pageSlugs = new Set<string>();
    const addKey = (key: string, provider: string | null): void => {
      const upper = key.toUpperCase();
      ticketKeys.add(upper);
      if (!provider) {
        bareTicketKeys.add(upper);
        return;
      }
      const held = keysByProvider.get(provider) ?? new Set<string>();
      held.add(upper);
      keysByProvider.set(provider, held);
    };

    for (const note of ctx.index.all()) {
      // Mirror notes themselves don't count as "linked from the vault".
      if (note.type === 'ticket' || note.type === 'wikipage') continue;
      for (const link of note.links) {
        const bare = link.target.split('#')[0]!.replace(/\.md$/, '').trim();
        // The name is taken off the END of the path, so a link written before
        // PD-10 (`tickets/PAY-142`) and one written after (`tickets/jira/PAY-142`)
        // name the same ticket. Only the second one names a tracker.
        const ref = parseMirrorRef(bare);
        if (ref?.kind === 'ticket') addKey(ref.name, ref.provider);
        else if (ref?.kind === 'wikipage') pageSlugs.add(ref.name.toLowerCase());
        else if (TICKET_KEY_RE.test(bare)) addKey(bare, null);
        else pageSlugs.add(slugify(bare).toLowerCase());
      }
    }
    // Existing mirror notes stay deep — a re-sync must keep them fresh even if
    // the last inbound link was removed (demotion is a human delete, not ours).
    for (const note of ctx.index.all()) {
      if (note.type === 'ticket') {
        const fm = note.frontmatter as Record<string, unknown>;
        // The note names its own tracker, so a refresh never has to guess.
        if (typeof fm['external_id'] === 'string')
          addKey(fm['external_id'], typeof fm['provider'] === 'string' ? fm['provider'] : null);
      } else if (note.type === 'wikipage') {
        pageSlugs.add(basename(note.slug).toLowerCase());
      }
    }
    return { ticketKeys, bareTicketKeys, keysByProvider, pageSlugs };
  }

  /**
   * The linked keys one connection may pull. A link that names its tracker
   * ("tickets/jira/PAY-142") harvests to that tracker and nowhere else. A bare
   * key names none: one key-holding connection may claim it, two may not.
   * Mirroring the wrong PAY-142 under the right name is worse than not
   * mirroring it, and only the vault can say which one it means.
   */
  private harvestKeysFor(connectionId: string, deep: DeepTargets): Set<string> {
    const provider = this.conns.get(connectionId)?.connector?.providers.ticket;
    const keys = new Set(provider ? (deep.keysByProvider.get(provider) ?? []) : []);
    const holders = this.ticketKeyHolders();
    if (holders.length === 1 && holders[0] === connectionId) {
      for (const key of deep.bareTicketKeys) keys.add(key);
    } else if (holders.length > 1) {
      for (const key of deep.bareTicketKeys) this.warnUntrackedKey(key, holders);
    }
    return keys;
  }

  /** Connections that can hold a ticket by its key. */
  private ticketKeyHolders(): string[] {
    const out: string[] = [];
    for (const [connectionId, state] of this.conns) {
      if (state.connector?.pullByKeys && state.connector.providers.ticket) out.push(connectionId);
    }
    return out;
  }

  /** Said once per key: the tick repeats every few minutes, and only an edit in
   *  the vault can answer it. */
  private warnUntrackedKey(key: string, holders: string[]): void {
    if (this.warnedKeys.has(key)) return;
    this.warnedKeys.add(key);
    console.warn(
      `[qale] sync: ${key} is linked without a tracker, and ${holders.join(' and ')} both hold keys. Not tracked — write the tracker into the link.`,
    );
  }

  private isDeep(
    connectionId: string,
    change: Exclude<ShallowChange, EventChange>,
    deep: DeepTargets,
    store: SyncStore,
  ): boolean {
    return this.isDeepRow(
      store.itemByExternalId(connectionId, change.external_id) ??
        shallowToRow(connectionId, change),
      deep,
    );
  }

  private isDeepRow(row: SyncItemRow, deep: DeepTargets): boolean {
    if (row.notePath) return true;
    if (row.kind === 'ticket') return deep.ticketKeys.has(row.externalId.toUpperCase());
    return deep.pageSlugs.has(slugify(row.title).toLowerCase());
  }

  // -------------------------------------------------------------------------
  // Tracked items: held by id, not by container
  // -------------------------------------------------------------------------

  /**
   * Every ticket the vault mentions, every one an agent was asked to watch, and
   * every one blocking something we already hold — pulled by id, whatever
   * project it lives in. Without this pass the only tickets that ever sync are
   * those inside a followed container, which makes `[[INFRA-88]]` in a note a
   * dead link unless the PM happens to follow all 900 tickets of INFRA.
   *
   * Tracked implies deep: if you named a ticket, you want to know when it moves.
   * The set is small by construction, and `writeMirror` skips items whose
   * `remote_updated` hasn't changed, so re-reading it each tick is close to free.
   */
  private async syncTracked(
    ctx: UseCaseContext,
    store: SyncStore,
    connectionId: string,
    nowMs: number,
  ): Promise<string[]> {
    const connector = this.conns.get(connectionId)?.connector;
    if (!connector?.pullByKeys) return [];

    // Linking IS the tracking gesture — no separate "watch this" chore.
    // (Wikipages have no key a human would type; theirs arrive via the agent
    // tool or the followed-space pull, so only ticket keys register here.)
    for (const key of this.harvestKeysFor(connectionId, this.deepTargets(ctx))) {
      store.track(connectionId, 'ticket', key, 'link', nowMs);
    }

    const followed = new Set(store.followedContainers(connectionId).map((c) => c.containerId));
    const byKind = new Map<'ticket' | 'wikipage', string[]>();
    for (const tracked of store.listTracked(connectionId)) {
      const prior = store.itemByExternalId(connectionId, tracked.externalId);
      // Already covered by its container's own incremental pull this tick.
      if (prior && followed.has(prior.container)) continue;
      const ids = byKind.get(tracked.kind) ?? [];
      ids.push(tracked.externalId);
      byKind.set(tracked.kind, ids);
    }

    const written: string[] = [];
    for (const [kind, ids] of byKind) {
      for (const change of await connector.pullByKeys(kind, ids)) {
        if (change.kind === 'event') continue;
        // Pulled by id, so the provider never says which container it came from
        // (and for tickets we infer it from the key) — keep what we already knew
        // rather than blanking a container the chips display.
        const prior = store.itemByExternalId(connectionId, change.external_id);
        const merged = { ...change, container: change.container || prior?.container || '' };
        store.upsertItem(shallowToRow(connectionId, merged));
        const path = await this.writeMirror(ctx, store, connectionId, merged, nowMs);
        if (path) written.push(path);
      }
    }
    return written;
  }

  /**
   * Track the tickets blocking (or blocked by) one we already mirror. Three
   * rules, all load-bearing:
   *
   * - **Blocking links only.** "Relates to" means whatever the person clicking
   *   it wanted it to mean; following it walks half the instance.
   * - **One hop.** We never harvest from an item we auto-added ourselves, or a
   *   messy epic would drag in its blockers' blockers on the next tick.
   * - **Capped, and loudly.** Silently truncating a dependency set is exactly
   *   the quiet incompleteness that makes a drift signal untrustworthy.
   */
  private trackBlockers(
    store: SyncStore,
    connectionId: string,
    externalId: string,
    links: readonly { type: string; key: string }[],
    nowMs: number,
  ): void {
    if (store.trackedSource(connectionId, externalId) === 'blocker') return;
    for (const link of links) {
      if (link.type !== 'blocks') continue;
      const key = link.key.trim().toUpperCase();
      if (!TICKET_KEY_RE.test(key)) continue;
      if (store.trackedSource(connectionId, key)) continue;
      if (store.countTrackedBySource(connectionId, 'blocker') >= BLOCKER_TRACK_CAP) {
        console.warn(
          `[qale] sync: blocker tracking cap (${BLOCKER_TRACK_CAP}) reached — ${key} not tracked`,
        );
        return;
      }
      store.track(connectionId, 'ticket', key, 'blocker', nowMs);
    }
  }

  /**
   * Where a draft may be addressed, with the provider that owns each container
   * (PD-9). The write tools name no product: the model picks a project, and this
   * answers which system holds it. Only followed containers are offered, because
   * a project the workspace does not read is one it cannot check a draft against.
   */
  outboundContainers(): OutboundContainer[] {
    this.reconfigure();
    const store = this.getStore();
    const out: OutboundContainer[] = [];
    for (const [connectionId, state] of this.conns) {
      const providers = state.connector?.providers;
      if (!providers) continue;
      for (const c of store?.followedContainers(connectionId) ?? []) {
        if (c.kind === 'calendar') continue;
        const provider = providers[c.kind];
        if (!provider) continue;
        out.push({ id: c.containerId, name: c.name, kind: c.kind, provider });
      }
    }
    return out;
  }

  /**
   * Watch an external item on request (the agent's `track_external`). This is a
   * READ decision — we're deciding to look at something, not writing anything
   * upstream — so it takes no approval card, per the outbound hard floor.
   */
  async trackExternal(kind: 'ticket' | 'wikipage', externalId: string): Promise<boolean> {
    const store = this.getStore();
    const id = externalId.trim();
    const connectionId = this.trackerFor(kind);
    if (!store || !id || !connectionId) return false;
    store.track(connectionId, kind, kind === 'ticket' ? id.toUpperCase() : id, 'agent', Date.now());
    await this.tick().catch(() => {});
    return true;
  }

  /** Stop watching — the one place tracking is ever removed, and only on a
   *  human/agent gesture. Sync never un-tracks behind the user's back. */
  untrackExternal(externalId: string): void {
    const store = this.getStore();
    const id = externalId.trim();
    // Deleting a row no connection holds costs nothing, and the caller names an
    // item, not a connection.
    for (const connectionId of this.conns.keys()) store?.untrack(connectionId, id);
  }

  /** The connection that can hold this kind of item by id. One tracker per kind
   *  today: the first connected one that mirrors the kind and pulls by key. */
  private trackerFor(kind: 'ticket' | 'wikipage'): string | null {
    this.reconfigure();
    for (const [connectionId, state] of this.conns) {
      const connector = state.connector;
      if (connector?.pullByKeys && connector.providers[kind]) return connectionId;
    }
    return null;
  }

  /**
   * THE mirror-note writer — the only code allowed to write ticket/wikipage
   * files. Skips unchanged items (same remote_updated/version as the note on
   * disk) so re-pull slack can't churn commits or reset freshness; a real
   * change writes the full body and sets `processing: new`, which is exactly what
   * makes the freshness spine mark dependents stale.
   */
  private async writeMirror(
    ctx: UseCaseContext,
    store: SyncStore,
    connectionId: string,
    change: Exclude<ShallowChange, EventChange>,
    nowMs: number,
  ): Promise<string | null> {
    try {
      const connector = this.conns.get(connectionId)!.connector!;
      const provider = connector.providers[change.kind];
      if (!provider) {
        throw new Error(`connector ${connector.id} mirrors no ${change.kind} provider`);
      }

      const existingRow = store.itemByExternalId(connectionId, change.external_id);
      // A bound path is where this mirror already lives, wherever that is: the
      // one-time move (PD-10) is the only thing that ever relocates a mirror.
      let path: string | null = existingRow?.notePath ?? null;
      if (!path) {
        const base = mirrorPath(
          change.kind,
          provider,
          change.kind === 'ticket' ? change.external_id : slugify(change.title),
        );
        path = base;
        // A wikipage path comes from its title, and two spaces can hold the same
        // title. Step the suffix until the slot is free or already ours, the way
        // meeting mirrors do. Ticket paths are the key itself, so they can't clash.
        for (
          let i = 2;
          change.kind === 'wikipage' && i <= 9 && (await this.pathHoldsOther(ctx, path, change));
          i += 1
        ) {
          path = base.replace(/\.md$/, `-${i}.md`);
        }
      }

      const remoteUpdated = normalizeIso(change.remote_updated, nowMs);
      const existing = await ctx.vault.readNote(path);
      if (existing) {
        const fm = existing.frontmatter as Record<string, unknown>;
        const unchanged =
          change.kind === 'wikipage'
            ? fm['version'] === change.version && fm['remote_updated'] === remoteUpdated
            : fm['remote_updated'] === remoteUpdated;
        if (unchanged) {
          if (!existingRow?.notePath) store.setNotePath(connectionId, change.external_id, path);
          return null;
        }
      }

      const full = await connector.fetchFull(change.kind, change.external_id);
      // A dependency we can see is a dependency worth holding — the other
      // team's blocker becomes a live chip on the note that links it without the
      // PM ever having heard of their project.
      if (change.kind === 'ticket' && full.links?.length) {
        this.trackBlockers(store, connectionId, change.external_id, full.links, nowMs);
      }
      const frontmatter =
        change.kind === 'ticket'
          ? ({
              type: 'ticket',
              title: `${change.external_id} · ${full.title}`,
              summary: `${change.external_id} — ${full.title} (${full.state ?? change.state})`,
              processing: 'new',
              provider,
              external_id: change.external_id,
              container: change.container,
              state: full.state ?? change.state,
              state_category: full.state_category ?? change.state_category,
              ...((full.assignee ?? change.assignee)
                ? { assignee: full.assignee ?? change.assignee }
                : {}),
              // Provider relationships: the indexer turns
              // these into `synced` edges (parent → part-of, links verbatim).
              ...(full.parentKey ? { parent: full.parentKey } : {}),
              ...(full.links?.length ? { links: full.links } : {}),
              // How this team files work, which the description never says:
              // the labels they use, the type, the priority, the area, who
              // wrote it. A skill that learns their conventions reads these.
              ...(full.labels?.length ? { labels: full.labels } : {}),
              ...(full.issueType ? { issue_type: full.issueType } : {}),
              ...(full.priority ? { priority: full.priority } : {}),
              ...(full.components?.length ? { components: full.components } : {}),
              ...(full.reporter ? { reporter: full.reporter } : {}),
              remote_updated: normalizeIso(full.remote_updated ?? change.remote_updated, nowMs),
              url: full.url,
            } as unknown as Frontmatter)
          : ({
              type: 'wikipage',
              title: full.title,
              summary: `${full.title} — mirrored page in ${change.container}`,
              processing: 'new',
              provider,
              external_id: change.external_id,
              container: change.container,
              version: full.version ?? change.version ?? 0,
              remote_updated: normalizeIso(full.remote_updated ?? change.remote_updated, nowMs),
              url: full.url,
            } as unknown as Frontmatter);

      const written = await ctx.vault.writeNote(path, frontmatter, full.bodyMarkdown || full.title);
      ctx.index.reindex(written);
      store.setNotePath(connectionId, change.external_id, path);
      return path;
    } catch (err) {
      console.error(
        `[qale] sync: mirror write failed for ${change.external_id}:`,
        err instanceof Error ? err.message : err,
      );
      // Same as the meeting mirror: a fetch that failed is worth shrugging off
      // and retrying, a path we built wrong is not, and only the second one can
      // leave the mark advanced over a mirror that was never written.
      if (isVaultBoundaryError(err)) throw err;
      return null;
    }
  }

  /** True when a note already sits at `path` and mirrors a different item. A
   *  note with no `external_id` counts as another item: it isn't ours to take. */
  private async pathHoldsOther(
    ctx: UseCaseContext,
    path: string,
    change: Exclude<ShallowChange, EventChange>,
  ): Promise<boolean> {
    const note = await ctx.vault.readNote(path);
    if (!note) return false;
    return (note.frontmatter as Record<string, unknown>)['external_id'] !== change.external_id;
  }

  // -------------------------------------------------------------------------
  // Read surface (chips, autocomplete, at-risk, delivery deltas)
  // -------------------------------------------------------------------------

  searchIndex(query: string, limit = 6): ShallowIndexItemDTO[] {
    const store = this.getStore();
    if (!store || !query.trim()) return [];
    // searchItems never returns events (SQL-side filter); the guard narrows the type.
    return store.searchItems(query.trim(), limit).flatMap((row) =>
      row.kind === 'event'
        ? []
        : [
            {
              kind: row.kind,
              externalId: row.externalId,
              slug: this.mirrorSlugFor(row, row.kind),
              container: row.container,
              containerName: this.containerName(row.provider, row.container) ?? row.container,
              title: row.title,
              ...(row.state ? { state: row.state } : {}),
              ...(isStateCategory(row.stateCategory) ? { stateCategory: row.stateCategory } : {}),
              url: row.url,
            },
          ],
    );
  }

  /**
   * Chip/hover metadata for one reference: a mirror slug that names its tracker
   * ("tickets/jira/PAY-142"), a flat pre-PD-10 slug, or a bare external id.
   *
   * Resolution is a lookup by id, never a path this builds (PD-11). A reference
   * that names no tracker is matched against every mirror and every shallow row
   * that holds the id, and if two trackers hold it the reference names no one
   * item: it comes back ambiguous, and the surfaces stop there.
   */
  refMeta(slugOrId: string): ExternalRefMetaDTO | null {
    const ctx = this.getContext();
    const store = this.getStore();
    if (!ctx) return null;

    const bare = slugOrId.split('#')[0]!.replace(/\.md$/, '').trim();
    // Deep mirror at the exact path first — actual data beats the shallow row,
    // and a path that names its tracker points at one file.
    const exact = this.mirrorByPath(ctx, `${bare}.md`);
    if (exact) return this.metaFromNote(exact);

    // The name is the last segment either way, so a chip written against the
    // flat layout still finds the mirror under its provider folder.
    const key = basename(bare);
    const wanted = parseMirrorRef(bare)?.provider ?? null;
    let notes = this.mirrorsNamed(ctx, bare, key);
    let rows = (store?.itemsByExternalId(key) ?? []).filter((r) => r.kind !== 'event');
    if (wanted) {
      notes = notes.filter((n) => noteProvider(n) === wanted);
      rows = rows.filter((r) => this.rowProvider(r) === wanted);
    } else {
      const holders = new Set<string>();
      for (const n of notes) {
        const p = noteProvider(n);
        if (p) holders.add(p);
      }
      for (const r of rows) {
        const p = this.rowProvider(r);
        if (p) holders.add(p);
      }
      if (holders.size > 1) {
        const kind = (notes[0]?.type ?? rows[0]?.kind ?? 'ticket') as MirrorKind;
        return ambiguousMeta(key, kind, [...holders]);
      }
    }
    if (notes[0]) return this.metaFromNote(notes[0]);

    // Shallow index fallback (followed but not linked yet). Events never render
    // as reference chips — meetings are notes, not external refs.
    const found =
      rows[0] ??
      (bare.startsWith('wikipages/')
        ? ((store?.itemsByKind('wikipage') ?? []).find(
            (r) =>
              slugify(r.title).toLowerCase() === key.toLowerCase() &&
              (!wanted || this.rowProvider(r) === wanted),
          ) ?? null)
        : null);
    if (!found || found.kind === 'event') return null;
    const row = found;
    const kind = row.kind as MirrorKind;
    const syncedAt = this.lastSyncFor(row.provider, row.container) ?? Date.now();
    return {
      kind,
      externalId: row.externalId,
      slug: this.mirrorSlugFor(row, kind),
      title: row.title,
      containerName: this.containerName(row.provider, row.container) ?? row.container,
      ...(row.state ? { state: row.state } : {}),
      ...(isStateCategory(row.stateCategory) ? { stateCategory: row.stateCategory } : {}),
      ...(row.assignee ? { assignee: row.assignee } : {}),
      url: row.url,
      remoteUpdated: row.remoteUpdated,
      syncedAt,
      stale: this.isStale(row.provider, syncedAt),
      health: this.healthOf(row.provider),
      notePath: row.notePath,
    };
  }

  pageBody(externalIdOrSlug: string): string | null {
    const ctx = this.getContext();
    if (!ctx) return null;
    const bare = externalIdOrSlug.replace(/\.md$/, '').trim();
    const note =
      this.mirrorsByExternalId(ctx, 'wikipage', bare)[0] ?? this.wikipagesBySlug(ctx, bare)[0];
    if (!note) return null;
    // Bodies aren't in the index — read from disk synchronously? The vault port
    // is async; callers get the indexed summary path instead. Handled in the
    // IPC handler (async) — this method resolves the path only.
    return note.path;
  }

  /** Blocked tickets the vault depends on — rendered in owning views only. */
  atRisk(): AtRiskLinkDTO[] {
    const ctx = this.getContext();
    if (!ctx) return [];
    const out: AtRiskLinkDTO[] = [];
    for (const note of ctx.index.all()) {
      if (note.type !== 'ticket') continue;
      const fm = note.frontmatter as Record<string, unknown>;
      if (fm['state_category'] !== 'blocked') continue;
      const linked = ctx.index
        .backlinks(note.slug)
        .map((b) => b.fromPath)
        .filter((p, i, arr) => arr.indexOf(p) === i);
      if (linked.length === 0) continue;
      out.push({
        externalId: String(fm['external_id'] ?? note.title),
        slug: note.slug,
        title: note.title,
        state: String(fm['state'] ?? 'Blocked'),
        stateCategory: 'blocked',
        reason: 'blocked',
        delta: `now ${String(fm['state'] ?? 'Blocked')}`,
        changedAt: String(fm['remote_updated'] ?? new Date(note.mtime).toISOString()),
        linked,
      });
    }
    return out;
  }

  /**
   * Synced meeting notes whose event overlaps [fromMs, toMs) — the shallow event
   * index read surface for time-aware sessions (before-meeting auto-prep) and
   * capture matching. Only events promoted to a meeting note (`note_path` set)
   * are returned; solo blocks and holds stay shallow. The store query compares
   * ISO strings (mixed-zone slop), so we over-fetch by a wide pad and filter to
   * the real instants here — the callers get precise, sorted results.
   */
  agenda(fromMs: number, toMs: number): AgendaMeeting[] {
    const store = this.getStore();
    if (!store) return [];
    const padMs = 12 * 60 * 60 * 1000;
    const rows = store.eventsBetween(
      GOOGLE_PROVIDER,
      new Date(fromMs - padMs).toISOString(),
      new Date(toMs + padMs).toISOString(),
    );
    const out: AgendaMeeting[] = [];
    for (const r of rows) {
      if (!r.notePath || !r.startAt || r.allDay) continue;
      const startMs = Date.parse(r.startAt);
      if (Number.isNaN(startMs)) continue;
      const endParsed = r.endAt ? Date.parse(r.endAt) : startMs;
      const endMs = Number.isNaN(endParsed) ? startMs : endParsed;
      if (startMs >= toMs || endMs < fromMs) continue; // precise overlap
      out.push({
        notePath: r.notePath,
        title: r.title,
        startMs,
        endMs,
        cancelled: r.eventStatus === 'cancelled',
        withOthers: hasOtherAttendee(rowToEvent(r)),
      });
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  /**
   * Meetings on the calendar around now, as CANDIDATES rather than an answer
   * (docs/arrival-agentic.md, AR-1). This used to be `matchMeetingForCapture`,
   * which picked one from a 90-minute window and attached a transcript to it
   * sight unseen; a call that ran long, or a recording exported the next
   * morning, silently landed on the wrong meeting. The clock is a hint now: the
   * arrival session gets the list and the transcript itself decides.
   */
  meetingCandidates(nowMs: number, backMs: number, forwardMs: number): AgendaMeeting[] {
    return this.agenda(nowMs - backMs, nowMs + forwardMs).filter((m) => !m.cancelled);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private mirrorByPath(ctx: UseCaseContext, path: string): IndexedNote | null {
    const n = ctx.index.get(path);
    return n && (n.type === 'ticket' || n.type === 'wikipage') ? n : null;
  }

  /**
   * Every mirror note a reference that names no tracker could mean, best match
   * first. Two answers is the ambiguous case: one id, two trackers.
   */
  private mirrorsNamed(ctx: UseCaseContext, bare: string, key: string): IndexedNote[] {
    const out: IndexedNote[] = [];
    // The regex only asks whether a ticket lookup is worth making at all.
    if (TICKET_KEY_RE.test(key)) out.push(...this.mirrorsByExternalId(ctx, 'ticket', key));
    out.push(...this.mirrorsByExternalId(ctx, 'wikipage', key));
    for (const note of this.wikipagesBySlug(ctx, bare)) {
      if (!out.includes(note)) out.push(note);
    }
    return out;
  }

  private mirrorsByExternalId(
    ctx: UseCaseContext,
    type: 'ticket' | 'wikipage',
    externalId: string,
  ): IndexedNote[] {
    return ctx.index
      .listByType(type)
      .filter(
        (n) =>
          String((n.frontmatter as Record<string, unknown>)['external_id'] ?? '').toLowerCase() ===
          externalId.toLowerCase(),
      );
  }

  private wikipagesBySlug(ctx: UseCaseContext, slug: string): IndexedNote[] {
    const bare = basename(slug).toLowerCase();
    return ctx.index.listByType('wikipage').filter((n) => basename(n.slug).toLowerCase() === bare);
  }

  /** The domain provider a shallow row mirrors, via the connector its
   *  connection is bound to. Null while the connection is unbound. */
  private rowProvider(row: SyncItemRow): string | null {
    if (row.kind === 'event') return null;
    return this.conns.get(row.provider)?.connector?.providers[row.kind] ?? null;
  }

  /**
   * The slug a link to this row should carry. The mirror note's own path when it
   * has one; otherwise where the writer would put it, which needs the provider
   * its connection stamps. An unbound connection leaves the flat form, and the
   * index resolves that by basename anyway.
   */
  private mirrorSlugFor(row: SyncItemRow, kind: MirrorKind): string {
    if (row.notePath) return slugFromPath(row.notePath);
    const provider = this.conns.get(row.provider)?.connector?.providers[kind] ?? null;
    return mirrorSlug(kind, provider, kind === 'ticket' ? row.externalId : slugify(row.title));
  }

  private metaFromNote(note: IndexedNote): ExternalRefMetaDTO {
    const fm = note.frontmatter as Record<string, unknown>;
    const str = (k: string): string | undefined =>
      typeof fm[k] === 'string' ? (fm[k] as string) : undefined;
    const container = str('container') ?? '';
    // The note names its provider ("jira"); the rows are filed by connection.
    // Two connections can hold one key, so prefer the row whose connector
    // stamps the provider this note carries.
    const declared = str('provider');
    const rows = this.getStore()?.itemsByExternalId(str('external_id') ?? '') ?? [];
    const row =
      rows.find(
        (r) =>
          this.conns.get(r.provider)?.connector?.providers[note.type as MirrorKind] === declared,
      ) ??
      rows[0] ??
      null;
    const connectionId = row?.provider ?? this.connectionForProvider(declared);
    const syncedAt = this.lastSyncFor(connectionId, container) ?? note.mtime;
    return {
      kind: note.type as 'ticket' | 'wikipage',
      externalId: str('external_id') ?? note.title,
      slug: note.slug,
      title: note.title,
      containerName: this.containerName(connectionId, container) ?? container,
      ...(str('state') ? { state: str('state') } : {}),
      ...(isStateCategory(fm['state_category']) ? { stateCategory: fm['state_category'] } : {}),
      ...(str('assignee') ? { assignee: str('assignee') } : {}),
      url: str('url') ?? row?.url ?? '',
      remoteUpdated: str('remote_updated') ?? new Date(note.mtime).toISOString(),
      syncedAt,
      stale: this.isStale(connectionId, syncedAt),
      health: this.healthOf(connectionId),
      notePath: note.path,
    };
  }

  /**
   * Which connection owns a mirror note. The sync row is the authority; this is
   * the fallback for a note whose row is gone, and all it has is the domain
   * provider its frontmatter names ("jira"). Only a bound connector can say
   * which connection mirrors that provider.
   */
  private connectionForProvider(provider: string | undefined): string | null {
    if (!provider) return null;
    for (const [connectionId, state] of this.conns) {
      if (Object.values(state.connector?.providers ?? {}).includes(provider)) return connectionId;
    }
    return null;
  }

  private containerName(connectionId: string | null, containerId: string): string | null {
    if (!connectionId) return null;
    return (
      this.getStore()
        ?.listContainers(connectionId)
        .find((c) => c.containerId === containerId)?.name ?? null
    );
  }

  private lastSyncFor(connectionId: string | null, containerId: string): number | null {
    if (!connectionId) return null;
    return (
      this.getStore()
        ?.listContainers(connectionId)
        .find((c) => c.containerId === containerId)?.lastSync ?? null
    );
  }

  /** A connection we can't name reads as healthy: nothing is known to be wrong,
   *  and a red chip on a mirror whose connection is gone helps nobody. */
  private healthOf(connectionId: string | null): ConnectionHealth {
    return (connectionId ? this.conns.get(connectionId)?.health : null) ?? 'ok';
  }

  private isStale(connectionId: string | null, syncedAt: number): boolean {
    return this.healthOf(connectionId) !== 'ok' || Date.now() - syncedAt > STALE_AFTER_MS;
  }
}

/**
 * The reason line under a recommended container. Two facts, both checkable: how
 * much of it is theirs, and when they were last in it. The count is the
 * provider's own total (the connector spends a second query on exactly that),
 * so this line can be read literally.
 */
function footprintReason(f: ContainerFootprint): string {
  const what =
    f.kind === 'wikipage'
      ? `You edited ${f.count} ${f.count === 1 ? 'page' : 'pages'} here`
      : `${f.count} ${f.count === 1 ? 'ticket is' : 'tickets are'} yours here`;
  const when = f.lastTouched ? whenLastTouched(f.lastTouched) : null;
  return when ? `${what}, ${when}` : what;
}

/** "last one yesterday" / "the newest 3 weeks ago" — never a bare timestamp. */
function whenLastTouched(iso: string): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  const days = Math.floor((Date.now() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'the last one today';
  if (days === 1) return 'the last one yesterday';
  if (days < 14) return `the last one ${days} days ago`;
  if (days < 60) return `the last one ${Math.round(days / 7)} weeks ago`;
  return `the last one ${Math.round(days / 30)} months ago`;
}

function shallowToRow(
  connectionId: string,
  change: Exclude<ShallowChange, EventChange>,
): SyncItemRow {
  return {
    provider: connectionId,
    kind: change.kind,
    externalId: change.external_id,
    container: change.container,
    title: change.title,
    state: change.kind === 'ticket' ? change.state : null,
    stateCategory: change.kind === 'ticket' ? change.state_category : null,
    assignee: change.kind === 'ticket' ? (change.assignee ?? null) : null,
    version: change.kind === 'wikipage' ? change.version : null,
    remoteUpdated: change.remote_updated,
    url: change.url,
    notePath: null,
    startAt: null,
    endAt: null,
    allDay: false,
    eventStatus: null,
    attendees: null,
    recurringId: null,
  };
}

function rowToShallow(row: SyncItemRow): Exclude<ShallowChange, EventChange> {
  return row.kind === 'ticket'
    ? {
        kind: 'ticket',
        external_id: row.externalId,
        container: row.container,
        title: row.title,
        state: row.state ?? 'Unknown',
        state_category: isStateCategory(row.stateCategory) ? row.stateCategory : 'open',
        ...(row.assignee ? { assignee: row.assignee } : {}),
        remote_updated: row.remoteUpdated,
        url: row.url,
      }
    : {
        kind: 'wikipage',
        external_id: row.externalId,
        container: row.container,
        title: row.title,
        version: row.version ?? 0,
        remote_updated: row.remoteUpdated,
        url: row.url,
      };
}

/**
 * Merge a pulled event change over the shallow row we already hold. Cancelled
 * instances arrive as stubs (id + status, little else) — the row keeps the last
 * substantive title/time/attendees so the mirror plan can still reason about
 * the note it created.
 */
function mergeEventRow(prior: SyncItemRow | null, change: EventChange): SyncItemRow {
  return {
    provider: GOOGLE_PROVIDER,
    kind: 'event',
    externalId: change.external_id,
    container: change.container || prior?.container || '',
    title: change.title || prior?.title || '(untitled)',
    state: null,
    stateCategory: change.event_status === 'cancelled' ? 'done' : 'open',
    assignee: null,
    version: null,
    remoteUpdated: change.remote_updated,
    url: change.url || prior?.url || '',
    notePath: prior?.notePath ?? null,
    startAt: change.start || prior?.startAt || null,
    endAt: change.end ?? prior?.endAt ?? null,
    allDay: change.start ? change.allDay : (prior?.allDay ?? false),
    eventStatus: change.event_status,
    attendees: change.attendees.length ? change.attendees : (prior?.attendees ?? null),
    recurringId: change.recurring_event_id ?? prior?.recurringId ?? null,
  };
}

/**
 * Resolve an event's human attendees to `[[people/…]]` wikilinks where a person
 * note carries a matching `email` (job 4) — otherwise the provider's display
 * name, else the raw email. The PM and rooms are excluded, mirroring the domain's
 * `eventParticipants`. Creating person notes stays a human gesture; unmatched
 * externals just render as plain emails.
 */
function resolveParticipants(ctx: UseCaseContext, event: SyncedCalendarEvent): string[] {
  const byEmail = new Map<string, string>();
  for (const p of ctx.index.listByType('person')) {
    const email = (p.frontmatter as Record<string, unknown>)['email'];
    if (typeof email === 'string' && email.trim()) byEmail.set(email.trim().toLowerCase(), p.slug);
  }
  const out: string[] = [];
  for (const a of event.attendees) {
    if (a.resource || a.self) continue;
    const slug = a.email ? byEmail.get(a.email.trim().toLowerCase()) : undefined;
    const label = slug ? `[[${slug}]]` : a.name?.trim() || a.email?.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Rebuild the domain event shape from a (merged) shallow row. */
function rowToEvent(row: SyncItemRow): SyncedCalendarEvent {
  return {
    external_id: row.externalId,
    title: row.title,
    start: row.startAt ?? '',
    ...(row.endAt ? { end: row.endAt } : {}),
    allDay: row.allDay,
    event_status: row.eventStatus ?? 'confirmed',
    attendees: row.attendees ?? [],
    ...(row.recurringId ? { recurring_event_id: row.recurringId } : {}),
    remote_updated: row.remoteUpdated,
    url: row.url,
  };
}
