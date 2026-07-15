import { computeFreshness, isBodyEditable, type Frontmatter, type Note } from '@pm/domain';
import type {
  Backlink,
  IndexedNote,
  ProblemHeatRow,
  ProposalRecord,
  VaultInfo,
  VaultTreeGroup,
} from '@pm/application';
import type {
  BacklinkDTO,
  HealthDTO,
  NoteDTO,
  NoteRefDTO,
  ProblemHeatDTO,
  ProblemStance,
  ProposalDTO,
  SearchHitDTO,
  VaultInfoDTO,
  VaultTreeDTO,
} from '@pm/ipc';
import type { SearchHit } from '@pm/domain';

/** Map domain/application entities to structured-clone-safe IPC DTOs. */

export function noteToDTO(note: Note, now: string): NoteDTO {
  const f = computeFreshness(note.frontmatter, now);
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
    freshness: {
      tracked: f.tracked,
      freshForDays: f.freshForDays,
      lastVerified: f.lastVerified,
      ageDays: f.ageDays,
      stale: f.stale,
      unverified: f.unverified,
    },
  };
}

export function indexedToRefDTO(n: IndexedNote, now?: string): NoteRefDTO {
  const stale = now ? computeFreshness(n.frontmatter as Frontmatter, now).stale : undefined;
  return {
    path: n.path,
    slug: n.slug,
    type: n.type,
    title: n.title,
    summary: n.summary,
    mtime: n.mtime,
    status: n.status,
    stale,
  };
}

export function treeToDTO(groups: VaultTreeGroup[], now: string): VaultTreeDTO {
  return {
    groups: groups.map((g) => ({
      dir: g.dir,
      type: g.type,
      layer: g.layer as 'raw' | 'derived' | 'authored',
      notes: g.notes.map((n) => indexedToRefDTO(n, now)),
    })),
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

export function problemHeatToDTO(row: ProblemHeatRow, now: string): ProblemHeatDTO {
  return {
    ...indexedToRefDTO(row.note, now),
    stance: ((row.note.frontmatter['stance'] as string) ?? 'exploring') as ProblemStance,
    evidenceCount: row.count,
    newest: row.newest,
  };
}

export function healthToDTO(h: HealthDTO): HealthDTO {
  return h;
}

export function proposalToDTO(rec: ProposalRecord): ProposalDTO {
  return {
    id: rec.id,
    kind: rec.kind as ProposalDTO['kind'],
    sessionId: rec.sessionId,
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

function deriveTitle(slug: string): string {
  const name = slug.split('/').pop() ?? slug;
  return name.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/[-_]+/g, ' ');
}
