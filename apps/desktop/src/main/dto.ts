import {
  backlinkTypeLabel,
  isBodyEditable,
  outboundEffect,
  titleFromSlug,
  transcriptRefs,
  zOutboundPayload,
  type Note,
  type OutboundEffectFacts,
} from '@qale/domain';
import type {
  Backlink,
  IndexedNote,
  ThemeHeatRow,
  ProposalRecord,
  RunnableSummary,
  UseCaseContext,
  VaultInfo,
  VaultTreeGroup,
} from '@qale/application';
import type {
  AgentDTO,
  BacklinkDTO,
  NoteDTO,
  NoteRefDTO,
  ThemeHeatDTO,
  ThemeStance,
  ProposalDTO,
  SearchHitDTO,
  SkillDTO,
  VaultInfoDTO,
  VaultTreeDTO,
} from '@qale/ipc';
import type { SearchHit } from '@qale/domain';
import type { CodeRunFacts } from './agents.js';

/** Map domain/application entities to structured-clone-safe IPC DTOs. */

export function noteToDTO(note: Note): NoteDTO {
  return {
    path: note.path,
    slug: note.slug,
    type: note.type,
    layer: note.layer,
    title:
      ((note.frontmatter as Record<string, unknown>)['title'] as string) ?? deriveTitle(note.slug),
    summary: note.frontmatter.summary,
    frontmatter: note.frontmatter as Record<string, unknown>,
    body: note.body,
    mtime: note.mtime,
    bodyEditable: isBodyEditable(note.type),
  };
}

export function indexedToRefDTO(n: IndexedNote): NoteRefDTO {
  const fm = n.frontmatter;
  const tags = Array.isArray(fm['tags'])
    ? (fm['tags'] as unknown[]).filter((t): t is string => typeof t === 'string')
    : undefined;
  return {
    path: n.path,
    slug: n.slug,
    type: n.type,
    title: n.title,
    summary: n.summary,
    mtime: n.mtime,
    lifecycle: n.lifecycle,
    tags: tags && tags.length > 0 ? tags : undefined,
    date: typeof fm['date'] === 'string' ? fm['date'] : undefined,
    time: typeof fm['time'] === 'string' ? fm['time'] : undefined,
    durationMin: typeof fm['duration_minutes'] === 'number' ? fm['duration_minutes'] : undefined,
    eventStatus:
      fm['event_status'] === 'confirmed' ||
      fm['event_status'] === 'tentative' ||
      fm['event_status'] === 'cancelled'
        ? fm['event_status']
        : undefined,
    // Meetings only. A calendar mirror is the one note the app knows happened
    // without anybody telling it, so it is the one note that can be empty in a
    // way worth mentioning (docs/capture-nudge.md).
    ...(n.type === 'meeting'
      ? {
          synced: typeof fm['external_id'] === 'string' && fm['external_id'].length > 0,
          captured: n.hasBody || transcriptRefs(fm).length > 0,
          ...(typeof fm['series'] === 'string' ? { series: fm['series'] } : {}),
        }
      : {}),
    supersedes: typeof fm['supersedes'] === 'string' ? fm['supersedes'] : undefined,
    supersededBy: typeof fm['superseded_by'] === 'string' ? fm['superseded_by'] : undefined,
    due: typeof fm['due'] === 'string' ? fm['due'] : undefined,
    owner: typeof fm['owner'] === 'string' ? fm['owner'] : undefined,
    resolvedOn: typeof fm['resolved'] === 'string' ? fm['resolved'] : undefined,
    sourceRef:
      Array.isArray(fm['sources']) && typeof fm['sources'][0] === 'string'
        ? (fm['sources'][0] as string)
        : undefined,
    stateCategory: isStateCategory(fm['state_category']) ? fm['state_category'] : undefined,
    state: typeof fm['state'] === 'string' ? fm['state'] : undefined,
    assignee: typeof fm['assignee'] === 'string' ? fm['assignee'] : undefined,
    remoteUpdated: typeof fm['remote_updated'] === 'string' ? fm['remote_updated'] : undefined,
  };
}

const STATE_CATEGORIES = ['open', 'in_progress', 'blocked', 'done'] as const;
function isStateCategory(v: unknown): v is (typeof STATE_CATEGORIES)[number] {
  return typeof v === 'string' && (STATE_CATEGORIES as readonly string[]).includes(v);
}

export function treeToDTO(groups: VaultTreeGroup[]): VaultTreeDTO {
  return {
    groups: groups.map((g) => ({
      dir: g.dir,
      type: g.type,
      layer: g.layer as 'raw' | 'derived' | 'authored',
      notes: g.notes.map((n) => indexedToRefDTO(n)),
    })),
  };
}

/**
 * A skill in the Skills view's row shape. `can` crosses the wire as the file
 * wrote it, and nothing else does: no clocks, because nothing in the app starts
 * a skill by itself, which is the whole difference between the two folders.
 */
export function skillToDTO(s: RunnableSummary): SkillDTO {
  return {
    path: s.path,
    slug: s.slug,
    kind: s.kind === 'voice' ? 'voice' : 'skill',
    name: s.name,
    title: s.title,
    summary: s.summary,
    can: s.can,
    errors: s.errors,
    mtime: s.mtime,
    files: s.files,
    lastUsedMs: s.lastUsedMs,
  };
}

/**
 * An agent in the Agents view's row shape: the file's own words (title,
 * summary, can) plus the facts only main knows — its clocks, the key,
 * when it last fired, when it last merely looked, pending cards. A file whose frontmatter has
 * errors reads as blocked, not quietly "on" — same doctrine as a missing key.
 */
export function agentFileToDTO(
  a: RunnableSummary,
  lastRunMs: number | null,
  lastCheckedMs: number | null,
  facts: CodeRunFacts | undefined,
  hasKey: boolean,
  pendingCards: number,
): AgentDTO {
  const broken = a.errors.length > 0;
  const blocked = a.enabled && (broken || (!!facts?.needsApiKey && !hasKey));
  return {
    id: a.name,
    title: a.title,
    summary: a.summary,
    path: a.path,
    enabled: a.enabled,
    status: !a.enabled ? 'off' : blocked ? 'blocked' : 'on',
    ...(blocked
      ? { blockedReason: broken ? `Its file needs fixing: ${a.errors[0]}` : facts!.blockedReason }
      : {}),
    // This app-run's ledger first (it knows about runs that produced nothing
    // yet), then the durable stamp, so quitting doesn't reset an agent to
    // "never ran".
    lastRunMs: lastRunMs ?? a.lastUsedMs,
    lastCheckedMs,
    lastQuietMs: a.lastQuietMs,
    lastStoppedMs: a.lastStoppedMs,
    // The app's clocks, and nothing from the file: a trigger with no dispatch
    // site behind it is a promise the file cannot keep. No facts entry means no
    // clock at all — the app genuinely never begins this one on its own.
    starts: facts?.starts ?? [],
    can: a.can,
    errors: a.errors,
    pendingCards,
    files: a.files,
  };
}

export function backlinkToDTO(b: Backlink): BacklinkDTO {
  return {
    from: indexedToRefDTO(b.from),
    type: b.type,
    typeLabel: b.type ? capitalize(backlinkTypeLabel(b.type, b.reversed)) : undefined,
    context: b.line !== undefined ? `line ${b.line}` : undefined,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function hitToDTO(h: SearchHit): SearchHitDTO {
  return {
    path: h.path,
    slug: h.slug,
    type: h.type,
    title: h.title,
    summary: h.summary,
    snippet: h.snippet,
    score: h.score,
  };
}

export function vaultInfoToDTO(info: VaultInfo): VaultInfoDTO {
  return {
    path: info.path,
    name: info.name,
    git: info.git,
    gitAvailable: info.gitAvailable,
    syncedBy: info.syncedBy,
    pathTooDeep: info.pathTooDeep,
    noteCount: info.noteCount,
  };
}

export function themeHeatToDTO(row: ThemeHeatRow): ThemeHeatDTO {
  return {
    ...indexedToRefDTO(row.note),
    stance: ((row.note.frontmatter['stance'] as string) ?? 'exploring') as ThemeStance,
    evidenceCount: row.count,
    newest: row.newest,
  };
}

/**
 * The lookups the outbound effect line needs, gathered ONCE per list call: who
 * an attendee address belongs to, and what the page/event behind an external id
 * is actually called. Two index scans for a whole queue, so a card never costs a
 * request to say what approving it does.
 */
export function outboundEffectFacts(
  ctx: UseCaseContext,
  selfEmails: string[],
): OutboundEffectFacts {
  const names = new Map<string, string>();
  for (const n of ctx.index.listByType('person')) {
    const email = n.frontmatter['email'];
    if (typeof email === 'string' && email.trim()) names.set(email.trim().toLowerCase(), n.title);
  }
  const titles = new Map<string, string>();
  for (const type of ['wikipage', 'meeting'] as const) {
    for (const n of ctx.index.listByType(type)) {
      const id = n.frontmatter['external_id'];
      if (typeof id === 'string' && id.trim()) titles.set(id.trim().toLowerCase(), n.title);
    }
  }
  return { selfEmails, names, titles };
}

export function proposalToDTO(
  rec: ProposalRecord,
  selfStarted?: string | null,
  effectFacts?: OutboundEffectFacts,
): ProposalDTO {
  // Outbound payloads persisted before the provider-generic vocabulary carry
  // `system` + legacy action names; normalize so the renderer always sees
  // `provider` + generic actions. Best-effort — an unparsable payload passes
  // through as-is rather than hiding the card.
  let payload = rec.payload;
  let effect: string | undefined;
  if (rec.kind === 'outbound') {
    const parsed = zOutboundPayload.safeParse(rec.payload);
    if (parsed.success) {
      payload = parsed.data;
      // Composed here, not in the renderer: the sentence is a property of the
      // card, so anything that shows one later says the same thing. Composed at
      // serialisation rather than at draft time so a card filed before the PO
      // named their own address still gets the "outside your company" flag.
      effect = outboundEffect(parsed.data, effectFacts);
    }
  }
  return {
    id: rec.id,
    kind: rec.kind as ProposalDTO['kind'],
    sessionId: rec.sessionId,
    skill: rec.skill,
    targetPath: rec.targetPath,
    payload: payload as ProposalDTO['payload'],
    // The agent authors the headline inside the payload (no DB column); surface
    // it as a first-class field so the renderer never reaches into payload shape.
    headline: (rec.payload as { headline?: string }).headline?.trim() || undefined,
    // No DB column either: the sweep that started the run writes the sentence to
    // the check ledger against its session id, and the caller reads it back.
    selfStarted: selfStarted?.trim() || undefined,
    effect,
    rationale: rec.rationale,
    evidence: rec.evidence,
    inference: rec.inference,
    asked: !!rec.asked,
    status: rec.status as ProposalDTO['status'],
    created: rec.created,
    resolved: rec.resolved,
  };
}

// Title-cased so legacy files without an explicit `title` don't read as raw slugs.
const deriveTitle = titleFromSlug;

// ---------------------------------------------------------------------------
// Contract drift guards (R3): @qale/ipc deliberately re-declares domain unions
// (it must stay dependency-free), so this module — which imports both — pins
// them together. A value added on one side only fails to compile HERE, not at
// a customer's runtime (`update_ticket` shipped exactly that way).
// ---------------------------------------------------------------------------
type _MutualLock<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _outboundActionLock: _MutualLock<
  import('@qale/ipc').OutboundAction,
  import('@qale/domain').OutboundAction
> = true;
const _outboundProviderLock: _MutualLock<
  import('@qale/ipc').OutboundProvider,
  import('@qale/domain').OutboundProvider
> = true;
const _noteTypeLock: _MutualLock<import('@qale/ipc').NoteType, import('@qale/domain').NoteType> =
  true;
const _stateCategoryLock: _MutualLock<
  import('@qale/ipc').StateCategory,
  import('@qale/domain').StateCategory
> = true;
void _outboundActionLock;
void _outboundProviderLock;
void _noteTypeLock;
void _stateCategoryLock;
