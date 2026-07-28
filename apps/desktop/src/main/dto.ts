import { backlinkTypeLabel, isBodyEditable, titleFromSlug, zOutboundPayload, type Note } from '@pm/domain';
import type {
  Backlink,
  IndexedNote,
  PingRecord,
  ThemeHeatRow,
  ProposalRecord,
  SkillSummary,
  VaultInfo,
  VaultTreeGroup,
} from '@pm/application';
import type {
  AgentPingDTO,
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
} from '@pm/ipc';
import type { SearchHit } from '@pm/domain';

/** Map domain/application entities to structured-clone-safe IPC DTOs. */

export function noteToDTO(note: Note): NoteDTO {
  return {
    path: note.path,
    slug: note.slug,
    type: note.type,
    layer: note.layer,
    title: (note.frontmatter as Record<string, unknown>)['title'] as string ?? deriveTitle(note.slug),
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
    status: n.status,
    tags: tags && tags.length > 0 ? tags : undefined,
    date: typeof fm['date'] === 'string' ? fm['date'] : undefined,
    time: typeof fm['time'] === 'string' ? fm['time'] : undefined,
    durationMin: typeof fm['duration_minutes'] === 'number' ? fm['duration_minutes'] : undefined,
    eventStatus:
      fm['event_status'] === 'confirmed' || fm['event_status'] === 'tentative' || fm['event_status'] === 'cancelled'
        ? fm['event_status']
        : undefined,
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

export function skillToDTO(s: SkillSummary): SkillDTO {
  return {
    path: s.path,
    slug: s.slug,
    name: s.name,
    kind: s.kind,
    summary: s.summary,
    tier: s.tier,
    bindings: s.bindings.map((b) => ({ mode: b.mode, event: b.event, sentence: b.sentence })),
    errors: s.errors,
    mtime: s.mtime,
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

export function proposalToDTO(rec: ProposalRecord): ProposalDTO {
  // Outbound payloads persisted before the provider-generic vocabulary carry
  // `system` + legacy action names; normalize so the renderer always sees
  // `provider` + generic actions. Best-effort — an unparsable payload passes
  // through as-is rather than hiding the card.
  let payload = rec.payload;
  if (rec.kind === 'outbound') {
    const parsed = zOutboundPayload.safeParse(rec.payload);
    if (parsed.success) payload = parsed.data;
  }
  return {
    id: rec.id,
    kind: rec.kind as ProposalDTO['kind'],
    sessionId: rec.sessionId,
    sessionType: rec.sessionType,
    targetPath: rec.targetPath,
    payload: payload as ProposalDTO['payload'],
    // The agent authors the headline inside the payload (no DB column); surface
    // it as a first-class field so the renderer never reaches into payload shape.
    headline: (rec.payload as { headline?: string }).headline?.trim() || undefined,
    rationale: rec.rationale,
    evidence: rec.evidence,
    inference: rec.inference,
    status: rec.status as ProposalDTO['status'],
    created: rec.created,
    resolved: rec.resolved,
  };
}

export function pingToDTO(rec: PingRecord): AgentPingDTO {
  return {
    id: rec.id,
    title: rec.title,
    body: rec.body,
    evidence: rec.evidence,
    sessionType: rec.sessionType,
    seedPrompt: rec.seedPrompt,
    targetPath: rec.targetPath,
    payload: rec.payload as AgentPingDTO['payload'],
    status: rec.status as AgentPingDTO['status'],
    created: rec.created,
  };
}

// Title-cased so legacy files without an explicit `title` don't read as raw slugs.
const deriveTitle = titleFromSlug;

// ---------------------------------------------------------------------------
// Contract drift guards (R3): @pm/ipc deliberately re-declares domain unions
// (it must stay dependency-free), so this module — which imports both — pins
// them together. A value added on one side only fails to compile HERE, not at
// a customer's runtime (`update_ticket` shipped exactly that way).
// ---------------------------------------------------------------------------
type _MutualLock<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _outboundActionLock: _MutualLock<
  import('@pm/ipc').OutboundAction,
  import('@pm/domain').OutboundAction
> = true;
const _outboundProviderLock: _MutualLock<
  import('@pm/ipc').OutboundProvider,
  import('@pm/domain').OutboundProvider
> = true;
const _noteTypeLock: _MutualLock<import('@pm/ipc').NoteType, import('@pm/domain').NoteType> = true;
const _stateCategoryLock: _MutualLock<
  import('@pm/ipc').StateCategory,
  import('@pm/domain').StateCategory
> = true;
void _outboundActionLock;
void _outboundProviderLock;
void _noteTypeLock;
void _stateCategoryLock;
