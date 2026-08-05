import { makeNote, type Frontmatter, type NoteType } from '@qale/domain';
import type {
  CheckLedgerPort,
  CreateProposalInput,
  IndexedNote,
  ProposalRecord,
  UseCaseContext,
} from '../src/ports.js';

/**
 * Shared fakes for the librarian's deterministic half: an IndexedNote builder, a
 * slug resolver, and an in-memory UseCaseContext. Drift pairing and the sweep
 * planner are both pure index work, so everything they need is here and neither
 * SQLite nor a model is involved.
 */

export function inote(args: {
  path: string;
  type: NoteType;
  frontmatter?: Record<string, unknown>;
  links?: string[];
  title?: string;
  summary?: string;
  mtime?: number;
}): IndexedNote {
  const slug = args.path.replace(/\.md$/, '');
  return {
    path: args.path,
    slug,
    type: args.type,
    layer: 'authored',
    title: args.title ?? slug.split('/').pop()!,
    summary: args.summary ?? `summary of ${slug}`,
    lifecycle: null,
    hasBody: true,
    mtime: args.mtime ?? 100,
    frontmatter: { type: args.type, summary: args.summary ?? `summary of ${slug}`, ...args.frontmatter },
    links: (args.links ?? []).map((target) => ({ target })),
  };
}

/** Wikilink resolution over the fake set: exact slug, else unique basename. */
export function resolverFor(notes: IndexedNote[]): (target: string) => string | null {
  return (target: string) => {
    const clean = target.replace(/^\[\[/, '').replace(/\]\].*$/, '');
    const exact = notes.find((n) => n.slug === clean);
    if (exact) return exact.path;
    if (clean.includes('/')) return null; // pathed target that doesn't exist
    const byBase = notes.filter((n) => n.slug.split('/').pop() === clean);
    return byBase.length === 1 ? byBase[0]!.path : null;
  };
}

export interface FakeDriftWorld {
  ctx: UseCaseContext;
  proposals: ProposalRecord[];
  checks: Map<string, string>;
  reindex(note: IndexedNote): void;
}

/** A full fake context. `bodies` maps note path → markdown body. */
export function fakeDriftWorld(args: {
  notes: IndexedNote[];
  bodies?: Record<string, string>;
  now?: string;
}): FakeDriftWorld {
  let notes = [...args.notes];
  const bodies = args.bodies ?? {};
  const nowIso = args.now ?? '2026-07-22T09:00:00.000Z';
  const proposals: ProposalRecord[] = [];
  const checks = new Map<string, string>();
  let pid = 0;

  const resolve = (t: string): string | null => resolverFor(notes)(t);

  const ctx: UseCaseContext = {
    vault: {
      root: () => '/fake',
      ensureScaffold: async () => {},
      readNote: async (p: string) => {
        const n = notes.find((x) => x.path === p);
        const body = bodies[p];
        if (!n || body === undefined) return null;
        return makeNote({ path: p, frontmatter: n.frontmatter as unknown as Frontmatter, body, mtime: n.mtime });
      },
      readRaw: async () => null,
      writeNote: async (p: string, frontmatter: Frontmatter, body: string) =>
        makeNote({ path: p, frontmatter, body, mtime: 1 }),
      writeBody: async (p: string, body: string) =>
        makeNote({ path: p, frontmatter: { type: 'note', summary: 's' } as Frontmatter, body, mtime: 1 }),
      writeRaw: async () => {},
      writeBinary: async () => {},
      remove: async () => {},
      exists: async () => false,
      list: async () => [],
      listDir: async () => [],
      contain: () => null,
    },
    index: {
      reindex: () => {},
      removeByPath: () => {},
      get: (p: string) => notes.find((n) => n.path === p) ?? null,
      all: () => notes,
      listByType: (t) => notes.filter((n) => n.type === t),
      search: () => [],
      backlinks: (slug: string) => {
        const target = notes.find((n) => n.slug === slug);
        if (!target) return [];
        return notes
          .filter((n) => n.links.some((l) => resolve(l.target) === target.path))
          .map((n) => ({ fromPath: n.path }));
      },
      resolve,
      count: () => notes.length,
      clear: () => {},
    },
    git: {
      available: async () => false,
      isRepo: async () => false,
      init: async () => {},
      ensureIgnored: async () => {},
      commitPaths: async () => {},
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => nowIso },
    proposals: {
      create: (input: CreateProposalInput, created: number) => {
        const rec: ProposalRecord = {
          ...input,
          skill: input.skill ?? null,
          id: `p${++pid}`,
          status: 'pending',
          created,
          resolved: null,
        };
        proposals.push(rec);
        return rec;
      },
      list: (status?: string) => proposals.filter((p) => !status || p.status === status),
      get: (id: string) => proposals.find((p) => p.id === id) ?? null,
      setStatus: (id: string, status: string, resolved: number | null) => {
        const rec = proposals.find((p) => p.id === id);
        if (rec) Object.assign(rec, { status, resolved });
      },
      pendingCount: () => proposals.filter((p) => p.status === 'pending').length,
    },
    checks: {
      get: (key: string) => checks.get(key) ?? null,
      set: (key: string, value: string) => void checks.set(key, value),
      list: (prefix: string) =>
        [...checks.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, value })),
      remove: (key: string) => void checks.delete(key),
    } satisfies CheckLedgerPort,
  };

  return {
    ctx,
    proposals,
    checks,
    // Every ctx closure reads the `notes` binding, so swapping the array is
    // enough for index/vault/resolve to see the change.
    reindex: (note: IndexedNote) => {
      notes = notes.map((n) => (n.path === note.path ? note : n));
    },
  };
}
