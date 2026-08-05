import type { Verification } from './frontmatter.js';

/**
 * OKF trust tiers (§5.3) derived from the `verified` family. Qale's freshness
 * spine already answers "is this still true?"; this adds the portable, explicit
 * "how much should I trust it, and who said so" the format standardizes. Purely
 * additive: no `verified` entries means `unverified`, never a rejection (§11).
 *
 * - `unverified` — nobody has confirmed it (the default, and the demo's staple);
 * - `machine` — a process or agent confirmed it (a `process:`/`agent/ver` actor);
 * - `human` — a person reviewed it (a `human:` actor), the highest tier.
 */
export type TrustTier = 'unverified' | 'machine' | 'human';

/** The three actor kinds in the OKF actor convention (§7). */
export type ActorKind = 'human' | 'process' | 'agent';

/**
 * Classify an actor string (§7): `human:<id>` → human, `process:<id>` → process,
 * anything else (`<agent>/<version>`, or a bare/legacy string) → agent. The
 * split is only ever "is the prefix `human:`" for the tier that matters, so an
 * unrecognized shape degrades to a machine actor rather than throwing.
 */
export function actorKind(by: string): ActorKind {
  const s = by.trim().toLowerCase();
  if (s.startsWith('human:')) return 'human';
  if (s.startsWith('process:')) return 'process';
  return 'agent';
}

/** Split an actor into its kind and identifier (`human:asa` → {kind, id: "asa"}). */
export function parseActor(by: string): { kind: ActorKind; id: string } {
  const kind = actorKind(by);
  const colon = by.indexOf(':');
  const id = kind === 'agent' ? by.trim() : by.slice(colon + 1).trim();
  return { kind, id: id || by.trim() };
}

/**
 * The trust tier for a note's `verified` list: `human` if any human reviewed it,
 * else `machine` if any process/agent confirmed it, else `unverified`.
 */
export function trustTier(verified: Verification[] | undefined | null): TrustTier {
  if (!verified || verified.length === 0) return 'unverified';
  if (verified.some((v) => actorKind(v.by) === 'human')) return 'human';
  return 'machine';
}

/** The most recent verification of the tier-setting kind, for display ("by X on Y"). */
export function latestVerification(
  verified: Verification[] | undefined | null,
): Verification | null {
  if (!verified || verified.length === 0) return null;
  const tier = trustTier(verified);
  const relevant =
    tier === 'human' ? verified.filter((v) => actorKind(v.by) === 'human') : verified;
  return [...relevant].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0] ?? null;
}

const TIER_LABEL: Record<TrustTier, string> = {
  unverified: 'Unverified',
  machine: 'Machine-confirmed',
  human: 'Human-reviewed',
};

export function trustTierLabel(tier: TrustTier): string {
  return TIER_LABEL[tier];
}
