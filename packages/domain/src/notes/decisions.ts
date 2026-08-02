import { normalizeLinkTarget } from './slug.js';
import type { DecisionFrontmatter } from './frontmatter.js';

/**
 * Decision supersedes-chains (PLAN-V2 §3.1, risk §6). Decisions are the append-
 * only spine: superseding one creates a NEW file with a `supersedes` back-pointer
 * and flips the old file's `standing` to `superseded` (+ a `superseded_by` forward
 * pointer). Bodies are never edited. These helpers walk and validate the chain;
 * cycle/lineage guards live here so a corrupted chain is caught at write time,
 * not excavated later.
 */

export interface DecisionNode {
  /** Slug (path without .md) — the chain's identity key. */
  slug: string;
  frontmatter: DecisionFrontmatter;
}

/** Normalise a wikilink/path ref to a bare slug for chain identity. */
export function refToSlug(ref: string | undefined | null): string | null {
  if (!ref) return null;
  const stripped = ref.replace(/^\[\[/, '').replace(/\]\]$/, '');
  const { target } = normalizeLinkTarget(stripped);
  return target || null;
}

export interface ChainResult {
  /** Ordered oldest → newest. */
  chain: DecisionNode[];
  /** True if a cycle was detected while walking (chain truncated at the cycle). */
  cycle: boolean;
}

/**
 * Build the full supersedes-chain that `startSlug` belongs to, oldest first.
 * `resolve` maps a slug to its node (or null if missing). Cycle-safe: a repeated
 * slug halts the walk and sets `cycle`.
 */
export function buildChain(
  startSlug: string,
  resolve: (slug: string) => DecisionNode | null,
): ChainResult {
  const start = resolve(startSlug);
  if (!start) return { chain: [], cycle: false };

  // Walk backwards to the root via `supersedes`.
  const seen = new Set<string>();
  let root = start;
  let cycle = false;
  while (true) {
    if (seen.has(root.slug)) {
      cycle = true;
      break;
    }
    seen.add(root.slug);
    const prevSlug = refToSlug(root.frontmatter.supersedes);
    if (!prevSlug) break;
    const prev = resolve(prevSlug);
    if (!prev) break;
    root = prev;
  }

  // Walk forwards from the root via `superseded_by`.
  const chain: DecisionNode[] = [];
  const forwardSeen = new Set<string>();
  let node: DecisionNode | null = root;
  while (node) {
    if (forwardSeen.has(node.slug)) {
      cycle = true;
      break;
    }
    forwardSeen.add(node.slug);
    chain.push(node);
    const nextSlug = refToSlug(node.frontmatter.superseded_by);
    node = nextSlug ? resolve(nextSlug) : null;
  }

  return { chain, cycle };
}

export interface SupersedeCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Validate that a new decision may supersede `targetSlug`: the target must exist,
 * must not already be superseded, and the new decision must not introduce a cycle
 * (i.e. the target must not be reachable forward from the new decision).
 */
export function checkSupersede(
  newSlug: string,
  targetSlug: string,
  resolve: (slug: string) => DecisionNode | null,
): SupersedeCheck {
  if (newSlug === targetSlug) {
    return { allowed: false, reason: 'a decision cannot supersede itself' };
  }
  const target = resolve(targetSlug);
  if (!target) {
    return { allowed: false, reason: `decision to supersede not found: ${targetSlug}` };
  }
  if (target.frontmatter.standing === 'superseded' || target.frontmatter.superseded_by) {
    const by = refToSlug(target.frontmatter.superseded_by);
    return {
      allowed: false,
      reason: `decision ${targetSlug} is already superseded${by ? ` by ${by}` : ''}`,
    };
  }
  // Cycle guard: newSlug must not already appear in target's chain.
  const { chain } = buildChain(targetSlug, resolve);
  if (chain.some((n) => n.slug === newSlug)) {
    return { allowed: false, reason: `superseding ${targetSlug} would form a cycle` };
  }
  return { allowed: true };
}
