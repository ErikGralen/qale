import { parse as parseYaml } from 'yaml';

/**
 * Skill files (PLAN-V2 §3.2) — a session type is a markdown file in `skills/`.
 * Plain-English When/Read/Produce/Then sections + structured guardrail
 * frontmatter, parsed into a {@link SkillConfig} the harness turns into a system
 * prompt + tool tier + checkpoint plan. Editing the file *is* configuring the
 * product; new session types are content, not code.
 */

export type SkillTier = 'observe' | 'suggest' | 'outbound';
const TIERS: SkillTier[] = ['observe', 'suggest', 'outbound'];

/**
 * Tier ordering — a skill that arrives mid-session ADDS permissions, never
 * removes them (Sessions v2, invariant 3: permissions attach to the material and
 * the skill). Comparing ranks is how the harness merges an arrival's tier with
 * whatever is already in force.
 */
export const TIER_RANK: Record<SkillTier, number> = { observe: 0, suggest: 1, outbound: 2 };

/**
 * Skills v2 (PLAN-V2 §skills) — the four kinds a skill file can declare:
 * - `session` — a packaged PO workflow (After-Meeting, Sprint Review, …);
 * - `voice` — a writing register forced into outbound drafts;
 * - `filing` — the librarian's filing rules;
 * - `guide` — reference the agent loads on demand via `use_skill`;
 * - `reaction` — a small session fired automatically by a workspace event.
 */
export type SkillKind = 'session' | 'voice' | 'filing' | 'guide' | 'reaction';
const SKILL_KINDS: SkillKind[] = ['session', 'voice', 'filing', 'guide', 'reaction'];

/**
 * How a skill attaches to the workspace (frontmatter `bindings[].mode`):
 * - `forced` — always in effect (voice registers, filing rules), optionally
 *   scoped (e.g. a voice that only applies to an audience);
 * - `triggered` — fires a session when a workspace `event` occurs, optionally
 *   filtered by a flat `when` field-equality condition;
 * - `dynamic` — discoverable; the agent pulls it in with `use_skill` when relevant.
 */
export type BindingMode = 'forced' | 'triggered' | 'dynamic';
const BINDING_MODES: BindingMode[] = ['forced', 'triggered', 'dynamic'];

/**
 * The closed event vocabulary a triggered binding may listen for (v1). Every
 * event here MUST have a live dispatch site — a describable-but-never-fired
 * event teaches users the Skills view lies. (`note.stale` was removed for
 * exactly that reason; reinstate it when the freshness sweep can dispatch it
 * once per stale transition.)
 */
export const SKILL_EVENTS = [
  'capture.ingested',
  'capture.transcript',
  'decision.superseded',
] as const;
export type SkillEvent = (typeof SKILL_EVENTS)[number];

const EVENT_PHRASE: Record<SkillEvent, string> = {
  'capture.ingested': 'anything is captured',
  'capture.transcript': 'a meeting transcript is captured',
  'decision.superseded': 'a decision is superseded',
};

/** One binding parsed from a skill's frontmatter. */
export interface SkillBinding {
  mode: BindingMode;
  /** Triggered only — the workspace event this reacts to. */
  event?: SkillEvent;
  /** Triggered only — flat field=value equality the event payload must match. */
  when?: Record<string, string>;
  /** Forced only — scope this register/rule to a named audience. */
  audience?: string;
  /**
   * Triggered only — the tier this arrival gets, overriding the skill's own
   * (Sessions v2 Part 5). This is how one arrival skill can branch on the
   * MATERIAL without weakening invariant 3: a transcript of the PO's own meeting
   * may draft outbound, a colleague's sales call may not, and that difference is
   * a property of what landed rather than a rule the model is asked to remember.
   * The skill's own `tier` is the default; a binding may name a different one for
   * the material it matches.
   */
  tier?: SkillTier;
}

export interface SkillGuardrails {
  /** The bar every produced item must clear before output is offered. */
  completionBar?: string;
  /** Conditions under which the session should stop and do nothing. */
  stoppingConditions: string[];
  /** Things the agent must push back on rather than silently accept. */
  redFlags: string[];
}

export interface SkillConfig {
  /** The skill's invocation name (e.g. "after-meeting"). Frontmatter `session_type`. */
  name: string;
  summary: string;
  /** Which of the four families this skill belongs to (frontmatter `skill_kind`). */
  kind: SkillKind;
  tier: SkillTier;
  when?: string;
  read?: string;
  produce?: string;
  then?: string;
  /** Ordered checkpoint names (e.g. digest → outline → draft). */
  checkpoints: string[];
  /** When true, propose-tools stay locked until a checkpoint is advanced. */
  gateOutput: boolean;
  /**
   * Sessions v2 Part 1 — this skill may keep working files under
   * `sessions/.files/<session-id>/`: a scratch folder it writes to freely, which
   * is NOT the memory. Opt-in per skill, because capability and spend are
   * separate gates: every session being able to scatter files is as wrong as
   * having to pick a mode before you can do ad-hoc analysis.
   */
  sessionFiles: boolean;
  guardrails: SkillGuardrails;
  /** How this skill attaches to the workspace (v2). Empty = inert. */
  bindings: SkillBinding[];
  /** Frontmatter problems surfaced on the Skills view (validation, not fatal). */
  errors: string[];
  /** The markdown body, frontmatter stripped — what a guide (no ## sections) carries. */
  body: string;
  raw: string;
}

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a skill file into its YAML frontmatter and markdown body. */
function split(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = raw.match(FRONTMATTER_RE);
  if (!m) return { fm: {}, body: raw };
  let fm: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1] ?? '');
    if (parsed && typeof parsed === 'object') fm = parsed as Record<string, unknown>;
  } catch {
    fm = {};
  }
  return { fm, body: raw.slice(m[0].length) };
}

/** Extract a `## Heading` section's text (case-insensitive), trimmed. */
function section(body: string, heading: string): string | undefined {
  // `$(?![\s\S])` is true end-of-string (JS has no \Z anchor).
  const re = new RegExp(`^#{1,3}\\s*${heading}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|$(?![\\s\\S]))`, 'im');
  const m = body.match(re);
  return m?.[1]?.trim() || undefined;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Flatten a `when:` map to `{field: "value"}` strings (numbers/bools coerced). */
function asFlatCondition(v: unknown): Record<string, string> {
  if (!isRecord(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val == null || typeof val === 'object') continue;
    out[k] = String(val);
  }
  return out;
}

/**
 * Parse and validate the `bindings:` list. Unknown modes/events are dropped
 * with an error string rather than throwing — a broken binding must surface in
 * the Skills view, never crash vault load.
 */
function parseBindings(raw: unknown, errors: string[]): SkillBinding[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    errors.push('bindings must be a list');
    return [];
  }
  const out: SkillBinding[] = [];
  raw.forEach((item, i) => {
    if (!isRecord(item)) {
      errors.push(`binding ${i + 1} must be a map`);
      return;
    }
    const mode = item['mode'];
    if (typeof mode !== 'string' || !BINDING_MODES.includes(mode as BindingMode)) {
      errors.push(`binding ${i + 1}: mode must be one of ${BINDING_MODES.join(', ')}`);
      return;
    }
    const binding: SkillBinding = { mode: mode as BindingMode };
    if (mode === 'triggered') {
      const event = item['event'];
      if (typeof event !== 'string' || !SKILL_EVENTS.includes(event as SkillEvent)) {
        errors.push(`binding ${i + 1}: triggered needs a known event (${SKILL_EVENTS.join(', ')})`);
        return;
      }
      binding.event = event as SkillEvent;
      const when = asFlatCondition(item['when']);
      if (Object.keys(when).length) binding.when = when;
      const tier = item['tier'];
      if (typeof tier === 'string') {
        if (!TIERS.includes(tier as SkillTier)) {
          errors.push(`binding ${i + 1}: unknown tier "${tier}" (one of: ${TIERS.join(', ')})`);
        } else {
          binding.tier = tier as SkillTier;
        }
      }
    }
    if (mode === 'forced' && typeof item['audience'] === 'string') {
      binding.audience = item['audience'];
    }
    out.push(binding);
  });
  return out;
}

/**
 * A plain-language sentence describing one binding, for the Skills view — the
 * PO reads how a skill attaches without decoding frontmatter.
 */
export function describeBinding(binding: SkillBinding, kind: SkillKind): string {
  if (binding.mode === 'forced') {
    if (kind === 'voice')
      return binding.audience
        ? `Always applied when drafting for ${binding.audience}.`
        : 'Always applied to outbound drafts.';
    return binding.audience ? `Always in effect for ${binding.audience}.` : 'Always in effect.';
  }
  if (binding.mode === 'triggered') {
    const phrase = binding.event ? EVENT_PHRASE[binding.event] : 'a matching event';
    const cond = binding.when
      ? ` where ${Object.entries(binding.when)
          .map(([f, v]) => `${f} is ${v}`)
          .join(' and ')}`
      : '';
    // The tier is what the PO can actually feel, so say it in their words rather
    // than leaving "tier: suggest" to be decoded from the file.
    const scope =
      binding.tier === 'observe'
        ? ' It only reads.'
        : binding.tier === 'suggest'
          ? ' It may propose notes, never outbound drafts.'
          : binding.tier === 'outbound'
            ? ' It may also draft outbound.'
            : '';
    return `Runs automatically when ${phrase}${cond}.${scope}`;
  }
  return 'Available on demand — the agent loads it when it is relevant.';
}

/**
 * Is this skill loadable on demand — listed in the session's skill index and
 * pullable with `use_skill` (Sessions v2 Part 3.1)?
 *
 * A `guide` is on-demand reference by definition, so it qualifies with or
 * without an explicit binding (back-compat: the shipped guides declare none).
 * Everything else needs a `dynamic` binding, which is exactly what the Skills
 * view already promises the PO — before this, a `mode: dynamic` session skill
 * was listed nowhere and loadable by nothing.
 */
export function isDynamicSkill(config: SkillConfig): boolean {
  if (config.kind === 'guide') return true;
  return config.bindings.some((b) => b.mode === 'dynamic');
}

/**
 * The text a skill hands the model when it ARRIVES mid-session (via `use_skill`
 * or an explicit pick), as opposed to being baked into the system prompt at
 * creation. Same content as {@link buildSystemPrompt} minus the shared preamble,
 * wrapped in a line that says the rules are now in force — the model must not
 * read an arriving skill as reference material it may weigh against the session
 * it is already in.
 */
export function buildSkillBrief(config: SkillConfig): string {
  const head =
    config.kind === 'guide'
      ? `## Guide: ${config.summary}`
      : `## Skill now in force: ${config.name} — ${config.summary}\nThese instructions govern the rest of this conversation. Follow them as you would your own; where they conflict with what you were told before, the more restrictive rule wins.`;
  // Session skills carry their content in ## When/Read/Produce/Then; guides are
  // plain prose with no sections at all, so fall back to the whole body.
  const structured = buildSystemPrompt('', config).trim();
  const body = structured || config.body.trim();
  return body ? `${head}\n\n${body}` : `${head}\n\n_(This skill file has no body.)_`;
}

/** Does a triggered binding fire for this event + payload? (dispatcher helper.) */
export function bindingMatches(
  binding: SkillBinding,
  event: SkillEvent,
  payload: Record<string, unknown>,
): boolean {
  if (binding.mode !== 'triggered' || binding.event !== event) return false;
  if (!binding.when) return true;
  return Object.entries(binding.when).every(([field, value]) => String(payload[field]) === value);
}

/**
 * Parse a skill file. `fallbackName` is used when the frontmatter omits
 * `session_type` (e.g. derived from the filename).
 */
export function parseSkill(raw: string, fallbackName: string): SkillConfig {
  const { fm, body } = split(raw);
  const tierRaw = typeof fm['tier'] === 'string' ? (fm['tier'] as string) : 'suggest';
  const tier: SkillTier = TIERS.includes(tierRaw as SkillTier) ? (tierRaw as SkillTier) : 'suggest';
  const kindRaw = typeof fm['skill_kind'] === 'string' ? (fm['skill_kind'] as string) : 'session';
  const kind: SkillKind = SKILL_KINDS.includes(kindRaw as SkillKind) ? (kindRaw as SkillKind) : 'session';
  const errors: string[] = [];
  if (typeof fm['skill_kind'] === 'string' && !SKILL_KINDS.includes(fm['skill_kind'] as SkillKind))
    errors.push(`unknown skill_kind "${fm['skill_kind']}"`);
  if (typeof fm['tier'] === 'string' && !TIERS.includes(tierRaw as SkillTier))
    errors.push(`unknown tier "${tierRaw}" — using "suggest" (one of: ${TIERS.join(', ')})`);
  const checkpoints = asStringArray(fm['checkpoints']);
  let gateOutput = fm['gate_output'] === true;
  if (gateOutput && checkpoints.length === 0) {
    // Without checkpoints the advance_checkpoint tool is never registered, so a
    // gate would lock proposing forever. Ignore it and flag the file.
    errors.push('gate_output needs checkpoints to gate on — ignored');
    gateOutput = false;
  }
  const bindings = parseBindings(fm['bindings'], errors);
  const hasTriggered = bindings.some((b) => b.mode === 'triggered');
  if (hasTriggered && typeof fm['session_type'] !== 'string')
    errors.push('a triggered binding requires an explicit session_type');
  if (hasTriggered && kind !== 'session' && kind !== 'reaction')
    errors.push(`a triggered binding on a ${kind} skill never fires — only session/reaction skills dispatch`);
  return {
    name: (fm['session_type'] as string) || fallbackName,
    summary: (fm['summary'] as string) || fallbackName,
    kind,
    tier,
    when: section(body, 'When'),
    read: section(body, 'Read'),
    produce: section(body, 'Produce'),
    then: section(body, 'Then'),
    checkpoints,
    gateOutput,
    sessionFiles: fm['session_files'] === true,
    guardrails: {
      completionBar: typeof fm['completion_bar'] === 'string' ? (fm['completion_bar'] as string) : undefined,
      stoppingConditions: asStringArray(fm['stopping_conditions']),
      redFlags: asStringArray(fm['red_flags']),
    },
    bindings,
    errors,
    body,
    raw,
  };
}

/**
 * Compose the session system prompt from a shared preamble + the skill's
 * When/Read/Produce/Then + guardrails + checkpoint plan. The preamble is injected
 * by the caller (it belongs to the agent runtime, keeping this package infra-free).
 */
export function buildSystemPrompt(preamble: string, config: SkillConfig): string {
  const parts: string[] = [preamble, ''];
  if (config.when) parts.push(`## When\n${config.when}`);
  if (config.read) parts.push(`## Read\n${config.read}`);
  if (config.produce) parts.push(`## Produce\n${config.produce}`);
  if (config.then) parts.push(`## Then\n${config.then}`);

  if (config.checkpoints.length > 0) {
    parts.push(
      `## How you work\nProceed one checkpoint at a time: ${config.checkpoints.join(' → ')}. ` +
        `Give the earlier checkpoints (a one-line digest, then an outline) before drafting anything. ` +
        (config.gateOutput
          ? `Call the \`advance_checkpoint\` tool as you pass each one — proposing (propose_*) stays locked until you have recorded your first checkpoint ("${config.checkpoints[0]}").`
          : `Call \`advance_checkpoint\` as you pass each one so the session receipt records your progress.`),
    );
  }

  const g = config.guardrails;
  const guard: string[] = [];
  if (g.completionBar) guard.push(`- Completion bar: ${g.completionBar}`);
  for (const s of g.stoppingConditions) guard.push(`- Stop if: ${s}`);
  for (const r of g.redFlags) guard.push(`- Push back on: ${r}`);
  if (guard.length > 0) parts.push(`## Guardrails\n${guard.join('\n')}`);

  return parts.join('\n\n');
}
