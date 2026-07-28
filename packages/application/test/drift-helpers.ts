import { makeNote, type Frontmatter, type NoteType } from '@pm/domain';
import type {
  CheckLedgerPort,
  CreatePingInput,
  CreateProposalInput,
  IndexedNote,
  PingPayload,
  PingRecord,
  ProposalRecord,
  UseCaseContext,
} from '../src/ports.js';

/**
 * Shared fakes for the wikipage-drift (Area F) tests: an IndexedNote builder,
 * a slug resolver, and a full in-memory UseCaseContext with scripted
 * completions — so candidate selection, the judgment gate, and the sweep's
 * dedupe/caps/ledger behavior are all testable without SQLite or a model.
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
    status: null,
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
  pings: PingRecord[];
  checks: Map<string, string>;
  /** Prompts the scripted model received, in order. */
  llmCalls: { system: string; prompt: string }[];
  setNow(iso: string): void;
  reindex(note: IndexedNote): void;
}

/**
 * A full fake context. `bodies` maps note path → markdown body; `completions`
 * is a scripted reply queue (a function per call, or one reply reused). Pass
 * `completions: null` to model "no key configured".
 */
export function fakeDriftWorld(args: {
  notes: IndexedNote[];
  bodies: Record<string, string>;
  completions: ((input: { system: string; prompt: string }) => string) | string | null;
  now?: string;
  /** Stand in for FTS: notes whose title or body contains the query, case-insensitively. */
  search?: boolean;
}): FakeDriftWorld {
  let notes = [...args.notes];
  let nowIso = args.now ?? '2026-07-22T09:00:00.000Z';
  const proposals: ProposalRecord[] = [];
  const pings: PingRecord[] = [];
  const checks = new Map<string, string>();
  const llmCalls: { system: string; prompt: string }[] = [];
  let pid = 0;
  let gid = 0;

  const resolve = (t: string): string | null => resolverFor(notes)(t);

  const ctx: UseCaseContext = {
    vault: {
      root: () => '/fake',
      ensureScaffold: async () => {},
      readNote: async (p: string) => {
        const n = notes.find((x) => x.path === p);
        const body = args.bodies[p];
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
      contain: () => null,
    },
    index: {
      reindex: () => {},
      removeByPath: () => {},
      get: (p: string) => notes.find((n) => n.path === p) ?? null,
      all: () => notes,
      listByType: (t) => notes.filter((n) => n.type === t),
      search: (query: string, limit: number) => {
        if (!args.search) return [];
        const q = query.toLowerCase();
        return notes
          .filter((n) => `${n.title}\n${args.bodies[n.path] ?? ''}`.toLowerCase().includes(q))
          .slice(0, limit)
          .map((n) => ({
            path: n.path,
            slug: n.slug,
            title: n.title,
            type: n.type,
            summary: n.summary,
            snippet: '',
            score: 1,
          }));
      },
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
      commitPaths: async () => {},
      history: async () => [],
      fileAt: async () => null,
    },
    clock: { now: () => nowIso },
    proposals: {
      create: (input: CreateProposalInput, created: number) => {
        const rec: ProposalRecord = {
          ...input,
          sessionType: input.sessionType ?? null,
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
      setEditDistance: () => {},
      pendingCount: () => proposals.filter((p) => p.status === 'pending').length,
      stats: () => ({
        pending: 0,
        accepted: 0,
        rejected: 0,
        stale: 0,
        edited: 0,
        avgApproveMs: null,
        approvalRate: null,
        byType: {},
      }),
    },
    pings: {
      create: (input: CreatePingInput, now: number) => {
        const rec: PingRecord = {
          ...input,
          payload: input.payload ?? null,
          id: `g${++gid}`,
          status: 'pending',
          created: now,
          resolved: null,
        };
        pings.push(rec);
        return rec;
      },
      list: (status?: string) => pings.filter((p) => !status || p.status === status),
      get: (id: string) => pings.find((p) => p.id === id) ?? null,
      setStatus: (id: string, status: string, resolved: number | null) => {
        const rec = pings.find((p) => p.id === id);
        if (rec) Object.assign(rec, { status, resolved });
      },
      updatePayload: (id: string, payload: PingPayload) => {
        const rec = pings.find((p) => p.id === id);
        if (rec) rec.payload = payload;
      },
      pendingCount: () => pings.filter((p) => p.status === 'pending').length,
      hasRecent: (key: string, since: number) =>
        pings.some(
          (p) => p.key === key && (p.status === 'pending' || p.resolved === null || p.resolved >= since),
        ),
    },
    checks: {
      get: (key: string) => checks.get(key) ?? null,
      set: (key: string, value: string) => void checks.set(key, value),
    } satisfies CheckLedgerPort,
    ...(args.completions === null
      ? {}
      : {
          completions: {
            complete: async (input: { system: string; prompt: string }) => {
              llmCalls.push(input);
              return typeof args.completions === 'string' ? args.completions : args.completions!(input);
            },
          },
        }),
  };

  return {
    ctx,
    proposals,
    pings,
    checks,
    llmCalls,
    setNow: (iso: string) => {
      nowIso = iso;
    },
    // Every ctx closure reads the `notes` binding, so swapping the array is
    // enough for index/vault/resolve to see the change.
    reindex: (note: IndexedNote) => {
      notes = notes.map((n) => (n.path === note.path ? note : n));
    },
  };
}
