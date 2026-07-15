import { z } from 'zod';

/**
 * Frontmatter schemas — THE single source of truth for note shape (PLAN-V2 §3.1).
 * Types are derived via `z.infer`; nothing else defines a note's fields. A note is
 * a discriminated union on `type`, which drives its folder, layer and permissions.
 *
 * The workspace is OKF-conformant: `type` is required, each folder has its own
 * schema, and consumers tolerate unknown keys — {@link parseFrontmatter} preserves
 * any frontmatter field it doesn't recognise rather than stripping it.
 */

export const NOTE_TYPES = [
  'meeting',
  'decision',
  'insight',
  'customer',
  'problem',
  'release',
  'person',
  'session',
  'skill',
  'note',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

/**
 * Layer governs edit permissions (see invariant.ts):
 * - `raw` — provenance is immutable (meeting transcripts, session receipts);
 * - `derived` — written/refreshed by the agent-harness, human-editable;
 * - `authored` — hub/spine pages the human owns.
 */
export const NOTE_LAYERS = ['raw', 'derived', 'authored'] as const;
export type NoteLayer = (typeof NOTE_LAYERS)[number];

/** Problem stance — the durable-belief vocabulary carried over from themes. */
export const PROBLEM_STANCES = ['exploring', 'watching', 'committed', 'wont-do'] as const;
export type ProblemStance = (typeof PROBLEM_STANCES)[number];

/** A decision's lifecycle: it is superseded, never edited (append-only spine). */
export const DECISION_STATUSES = ['active', 'superseded'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const CONFIDENCE_LEVELS = ['high', 'med', 'low'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const CUSTOMER_STATUSES = ['prospect', 'active', 'churned'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const RELEASE_STATUSES = ['planned', 'shipped'] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

/** A wikilink string like "[[decisions/adopt-workos]]" or an external URL. */
export const zRef = z.string().min(1);

export const zSource = z.object({
  system: z.string().min(1),
  author: z.string().optional(),
  url: z.string().url().optional(),
});
export type SourceRef = z.infer<typeof zSource>;

/** Every note carries a one-line summary — the token-cheap retrieval index. */
const base = {
  summary: z.string().min(1, 'summary is mandatory — it is the retrieval index'),
  title: z.string().optional(),
  tags: z.array(z.string()).optional(),
};

/**
 * Freshness fields (PLAN-V2 §3.1). Claim-like notes decay on a type-appropriate
 * clock; `fresh_for` (e.g. "90d") overrides the per-type default, `last_verified`
 * is stamped when a human approves/re-verifies. See freshness.ts for the maths.
 */
const freshness = {
  last_verified: z.string().optional(),
  fresh_for: z.string().optional(),
};

export const zMeeting = z.object({
  type: z.literal('meeting'),
  ...base,
  date: z.string().optional(),
  participants: z.array(z.string()).optional(),
  source: zSource.optional(),
  /** Private meeting — capture off, nothing formalized (PLAN-V2 §3.4). */
  safe_space: z.boolean().optional(),
  customer: zRef.optional(),
});

export const zDecision = z.object({
  type: z.literal('decision'),
  ...base,
  ...freshness,
  status: z.enum(DECISION_STATUSES).default('active'),
  date: z.string().optional(),
  deciders: z.array(z.string()).optional(),
  sources: z.array(zRef).default([]),
  /** The decision this one replaces (back-pointer forms the supersedes-chain). */
  supersedes: zRef.optional(),
  /** Set when a newer decision replaces this one; body is never edited. */
  superseded_by: zRef.optional(),
  problem: zRef.optional(),
});

export const zInsight = z.object({
  type: z.literal('insight'),
  ...base,
  ...freshness,
  evidence: z.array(zRef).min(1, 'insights must cite evidence'),
  confidence: z.enum(CONFIDENCE_LEVELS).default('med'),
  customer: zRef.optional(),
  problem: zRef.optional(),
});

export const zCustomer = z.object({
  type: z.literal('customer'),
  ...base,
  ...freshness,
  status: z.enum(CUSTOMER_STATUSES).default('active'),
  segment: z.string().optional(),
});

export const zProblem = z.object({
  type: z.literal('problem'),
  ...base,
  ...freshness,
  stance: z.enum(PROBLEM_STANCES).default('exploring'),
  evidence: z.array(zRef).default([]),
  customer: zRef.optional(),
});

export const zRelease = z.object({
  type: z.literal('release'),
  ...base,
  date: z.string().optional(),
  status: z.enum(RELEASE_STATUSES).default('planned'),
  audiences: z.array(z.string()).optional(),
  sources: z.array(zRef).default([]),
});

export const zPerson = z.object({
  type: z.literal('person'),
  ...base,
  ...freshness,
  role: z.string().optional(),
  cares_about: z.array(z.string()).optional(),
  /** The what-they-were-told ledger clock: when this person was last updated. */
  last_told: z.string().optional(),
  customer: zRef.optional(),
});

/** Session transcript — the replayable audit trail, written by the harness. */
export const zSession = z.object({
  type: z.literal('session'),
  ...base,
  session_type: z.string(),
  started: z.string().optional(),
  ended: z.string().optional(),
  reads: z.array(zRef).default([]),
  writes: z.array(zRef).default([]),
  source_meeting: zRef.optional(),
});

/**
 * Skill file — a session type / voice guide / filing rule. The rich harness
 * config (checkpoints, tiers, guardrails) is parsed by @pm/sessions from the raw
 * file; the note schema only needs enough to list and route it.
 */
export const SKILL_KINDS = ['session', 'voice', 'filing'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export const zSkill = z.object({
  type: z.literal('skill'),
  ...base,
  skill_kind: z.enum(SKILL_KINDS).default('session'),
});

/** Generic authored note — the fallback so any markdown file still indexes. */
export const zNote = z.object({
  type: z.literal('note'),
  ...base,
  ...freshness,
  sources: z.array(zRef).default([]),
});

export const zFrontmatter = z.discriminatedUnion('type', [
  zMeeting,
  zDecision,
  zInsight,
  zCustomer,
  zProblem,
  zRelease,
  zPerson,
  zSession,
  zSkill,
  zNote,
]);

export type Frontmatter = z.infer<typeof zFrontmatter>;
export type MeetingFrontmatter = z.infer<typeof zMeeting>;
export type DecisionFrontmatter = z.infer<typeof zDecision>;
export type InsightFrontmatter = z.infer<typeof zInsight>;
export type CustomerFrontmatter = z.infer<typeof zCustomer>;
export type ProblemFrontmatter = z.infer<typeof zProblem>;
export type ReleaseFrontmatter = z.infer<typeof zRelease>;
export type PersonFrontmatter = z.infer<typeof zPerson>;
export type SessionFrontmatter = z.infer<typeof zSession>;
export type SkillFrontmatter = z.infer<typeof zSkill>;
export type NoteFrontmatter = z.infer<typeof zNote>;

/** Which on-disk folder + layer a note type lives in (PLAN-V2 §3.1). */
export const NOTE_TYPE_META: Record<NoteType, { dir: string; layer: NoteLayer }> = {
  meeting: { dir: 'meetings', layer: 'derived' },
  decision: { dir: 'decisions', layer: 'authored' },
  insight: { dir: 'insights', layer: 'derived' },
  customer: { dir: 'customers', layer: 'authored' },
  problem: { dir: 'problems', layer: 'authored' },
  release: { dir: 'releases', layer: 'authored' },
  person: { dir: 'people', layer: 'authored' },
  session: { dir: 'sessions', layer: 'derived' },
  skill: { dir: 'skills', layer: 'authored' },
  note: { dir: 'notes', layer: 'authored' },
};

export function layerForType(type: NoteType): NoteLayer {
  return NOTE_TYPE_META[type].layer;
}

export function dirForType(type: NoteType): string {
  return NOTE_TYPE_META[type].dir;
}

/** Reverse lookup: which note type a top-level workspace folder maps to. */
export function typeForDir(dir: string): NoteType | null {
  const entry = (Object.keys(NOTE_TYPE_META) as NoteType[]).find(
    (t) => NOTE_TYPE_META[t].dir === dir,
  );
  return entry ?? null;
}

export interface ParseResult {
  ok: boolean;
  data?: Frontmatter;
  error?: string;
}

/**
 * Validate an unknown frontmatter object against the schema for its `type`.
 * Unknown keys are PRESERVED (merged back over the validated result) so the
 * workspace stays OKF-tolerant and round-trips fields we don't model yet.
 */
export function parseFrontmatter(input: unknown): ParseResult {
  const result = zFrontmatter.safeParse(input);
  if (result.success) {
    const merged =
      input && typeof input === 'object'
        ? { ...(input as Record<string, unknown>), ...result.data }
        : result.data;
    return { ok: true, data: merged as Frontmatter };
  }
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  };
}
