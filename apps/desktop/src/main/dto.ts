import { isBodyEditable, titleFromSlug, type Note } from '@pm/domain';
import type {
  Backlink,
  IndexedNote,
  PingRecord,
  ProblemHeatRow,
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
  ProblemHeatDTO,
  ProblemStance,
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
    supersedes: typeof fm['supersedes'] === 'string' ? fm['supersedes'] : undefined,
    supersededBy: typeof fm['superseded_by'] === 'string' ? fm['superseded_by'] : undefined,
    due: typeof fm['due'] === 'string' ? fm['due'] : undefined,
    owner: typeof fm['owner'] === 'string' ? fm['owner'] : undefined,
    resolvedOn: typeof fm['resolved'] === 'string' ? fm['resolved'] : undefined,
    sourceRef:
      Array.isArray(fm['sources']) && typeof fm['sources'][0] === 'string'
        ? (fm['sources'][0] as string)
        : undefined,
  };
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
    context: b.line !== undefined ? `line ${b.line}` : undefined,
  };
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
  return { path: info.path, name: info.name, git: info.git, noteCount: info.noteCount };
}

export function problemHeatToDTO(row: ProblemHeatRow): ProblemHeatDTO {
  return {
    ...indexedToRefDTO(row.note),
    stance: ((row.note.frontmatter['stance'] as string) ?? 'exploring') as ProblemStance,
    evidenceCount: row.count,
    newest: row.newest,
  };
}

export function proposalToDTO(rec: ProposalRecord): ProposalDTO {
  return {
    id: rec.id,
    kind: rec.kind as ProposalDTO['kind'],
    sessionId: rec.sessionId,
    sessionType: rec.sessionType,
    targetPath: rec.targetPath,
    payload: rec.payload as ProposalDTO['payload'],
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
