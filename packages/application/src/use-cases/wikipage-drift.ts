import {
  buildChain,
  refToSlug,
  type DecisionFrontmatter,
  type DecisionNode,
  type WikipageFrontmatter,
} from '@qale/domain';
import type { IndexedNote } from '../ports.js';
import { logError } from './proposals.js';

/**
 * Wikipage stewardship, the half that is a graph fact: which mirrored pages sit
 * in which decision's orbit. The vault holds what was decided; Confluence pages
 * rot after every decision, and this is what notices a page and a decision are
 * standing next to each other at all.
 *
 * Whether the page actually contradicts the decision is a reading job, so it
 * belongs to a librarian session and not to this file. Pairing stays here
 * because it is traversal: sending an agent to rediscover who links whom every
 * run would buy nothing and cost plenty.
 */

/** Alias of the package's globalThis-guarded logger (proposals.ts) — sweep
 *  failure paths must be diagnosable, never silent. */
export const logSweepError = logError;

export interface DriftPair {
  page: {
    path: string;
    slug: string;
    title: string;
    externalId: string;
    provider: string;
    url: string;
    /** The mirror's state at pairing time, which any page update drafts against. */
    version?: number;
    remoteUpdated?: string;
  };
  decision: { path: string; slug: string; title: string; summary: string };
  /** The supersedes-chain the decision heads, oldest → newest (head last). */
  chain: { slug: string; title: string; summary: string; standing: string; date?: string }[];
  /** How the page entered the decision's orbit — the hub/decision that links it. */
  via: string;
  /**
   * Deterministic change marker: the head decision's mtime × the page's
   * provider version. Equal revision means nothing moved since the librarian
   * last read this pair; a supersede flips the head (new pair key), a re-sync
   * bumps the version.
   */
  revision: string;
  /** Stable finding key — `page-drift:<pageSlug>:<decisionSlug>`. */
  key: string;
}

/**
 * Pair every deep-tracked wikipage with the ACTIVE decisions in its orbit.
 * A page qualifies only when a theme hub or a decision links it
 * (linking IS the tracking gesture — same rule as deep-track mirroring); the
 * decisions paired with it are those linked from the same hub, pointing at the
 * same hub, or linking the page directly. Superseded decisions never head a
 * pair — they appear only as chain context. Output order is deterministic.
 */
export function selectDriftPairs(
  notes: IndexedNote[],
  resolve: (target: string) => string | null,
): DriftPair[] {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  // `resolve` hits live SQLite; pages × decisions × links would re-query the
  // same targets every 5 minutes. One cached resolution per target per sweep.
  const resolveCache = new Map<string, string | null>();
  const resolveOnce = (target: string): string | null => {
    let hit = resolveCache.get(target);
    if (hit === undefined) {
      hit = resolve(target);
      resolveCache.set(target, hit);
    }
    return hit;
  };
  const linkPathsCache = new Map<IndexedNote, string[]>();
  const linkPaths = (n: IndexedNote): string[] => {
    let paths = linkPathsCache.get(n);
    if (!paths) {
      paths = n.links.map((l) => resolveOnce(l.target)).filter((p): p is string => !!p);
      linkPathsCache.set(n, paths);
    }
    return paths;
  };

  const decisions = notes.filter((n) => n.type === 'decision');

  const resolveNode = (slug: string): DecisionNode | null => {
    const path = resolveOnce(slug);
    const note = path ? byPath.get(path) : undefined;
    if (!note || note.type !== 'decision') return null;
    return { slug: note.slug, frontmatter: note.frontmatter as unknown as DecisionFrontmatter };
  };

  const isActive = (d: IndexedNote): boolean => {
    const fm = d.frontmatter as Record<string, unknown>;
    return fm['standing'] !== 'superseded' && !fm['superseded_by'];
  };

  const pairs = new Map<string, DriftPair>();
  for (const page of notes) {
    if (page.type !== 'wikipage') continue;
    const fm = page.frontmatter as unknown as WikipageFrontmatter;
    if (!fm.external_id) continue;

    // Who links this page? Only spine-adjacent linkers count.
    const linkers = notes.filter(
      (n) => (n.type === 'theme' || n.type === 'decision') && linkPaths(n).includes(page.path),
    );
    if (linkers.length === 0) continue;

    const paired = new Map<string, { decision: IndexedNote; via: string }>();
    for (const linker of linkers) {
      if (linker.type === 'decision') {
        paired.set(linker.path, { decision: linker, via: linker.path });
        continue;
      }
      // Hub → every decision in the hub's orbit.
      for (const d of decisions) {
        const dLinks = linkPaths(d);
        const themeRef = refToSlug(
          (d.frontmatter as Record<string, unknown>)['theme'] as string | undefined,
        );
        const inOrbit =
          linkPaths(linker).includes(d.path) ||
          dLinks.includes(linker.path) ||
          (themeRef !== null && resolveOnce(themeRef) === linker.path);
        if (inOrbit && !paired.has(d.path)) paired.set(d.path, { decision: d, via: linker.path });
      }
    }
    // Hubs also cite superseded decisions; only chain heads get judged. A
    // superseded DIRECT linker still counts as orbit — "the page still matches
    // the old decision" is the flagship drift case, so the pair heads at the
    // active end of that decision's chain instead of being dropped.
    for (const entry of paired.values()) {
      const { via } = entry;
      let decision = entry.decision;
      if (!isActive(decision)) {
        const headSlug = buildChain(decision.slug, resolveNode).chain.at(-1)?.slug;
        const headPath = headSlug ? resolveOnce(headSlug) : null;
        const head = headPath ? byPath.get(headPath) : undefined;
        if (!head || head.type !== 'decision' || !isActive(head)) continue;
        decision = head;
      }
      const { chain } = buildChain(decision.slug, resolveNode);
      const chainMeta = chain.map((node) => {
        const note = byPath.get(resolve(node.slug) ?? '') ?? null;
        return {
          slug: node.slug,
          title: note?.title ?? node.slug,
          summary: note?.summary ?? node.frontmatter.summary,
          standing: node.frontmatter.standing ?? 'active',
          ...(node.frontmatter.date ? { date: node.frontmatter.date } : {}),
        };
      });
      const key = `page-drift:${page.slug}:${decision.slug}`;
      if (pairs.has(key)) continue;
      pairs.set(key, {
        page: {
          path: page.path,
          slug: page.slug,
          title: page.title,
          externalId: fm.external_id,
          provider: fm.provider,
          url: fm.url,
          ...(typeof fm.version === 'number' ? { version: fm.version } : {}),
          ...(fm.remote_updated ? { remoteUpdated: fm.remote_updated } : {}),
        },
        decision: {
          path: decision.path,
          slug: decision.slug,
          title: decision.title,
          summary: decision.summary,
        },
        chain: chainMeta,
        via,
        revision: `d:${decision.mtime}|p:${fm.version ?? page.mtime}`,
        key,
      });
    }
  }
  return [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key));
}
