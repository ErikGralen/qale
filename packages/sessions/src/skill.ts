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

export interface SkillGuardrails {
  /** The bar every produced item must clear before output is offered. */
  completionBar?: string;
  /** Conditions under which the session should stop and do nothing. */
  stoppingConditions: string[];
  /** Things the agent must push back on rather than silently accept. */
  redFlags: string[];
}

export interface SkillConfig {
  /** The session-type key this skill defines (e.g. "after-meeting"). */
  name: string;
  summary: string;
  tier: SkillTier;
  when?: string;
  read?: string;
  produce?: string;
  then?: string;
  /** Ordered checkpoint names (e.g. digest → outline → draft). */
  checkpoints: string[];
  /** When true, propose-tools stay locked until a checkpoint is advanced. */
  gateOutput: boolean;
  guardrails: SkillGuardrails;
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
  const re = new RegExp(`^#{1,3}\\s*${heading}\\s*$([\\s\\S]*?)(?=^#{1,3}\\s|\\Z)`, 'im');
  const m = body.match(re);
  return m?.[1]?.trim() || undefined;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

/**
 * Parse a skill file. `fallbackName` is used when the frontmatter omits
 * `session_type` (e.g. derived from the filename).
 */
export function parseSkill(raw: string, fallbackName: string): SkillConfig {
  const { fm, body } = split(raw);
  const tierRaw = typeof fm['tier'] === 'string' ? (fm['tier'] as string) : 'suggest';
  const tier: SkillTier = TIERS.includes(tierRaw as SkillTier) ? (tierRaw as SkillTier) : 'suggest';
  return {
    name: (fm['session_type'] as string) || fallbackName,
    summary: (fm['summary'] as string) || fallbackName,
    tier,
    when: section(body, 'When'),
    read: section(body, 'Read'),
    produce: section(body, 'Produce'),
    then: section(body, 'Then'),
    checkpoints: asStringArray(fm['checkpoints']),
    gateOutput: fm['gate_output'] === true,
    guardrails: {
      completionBar: typeof fm['completion_bar'] === 'string' ? (fm['completion_bar'] as string) : undefined,
      stoppingConditions: asStringArray(fm['stopping_conditions']),
      redFlags: asStringArray(fm['red_flags']),
    },
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
          ? `Call the \`advance_checkpoint\` tool as you pass each one — proposing (propose_*) is locked until you have advanced at least to your outline.`
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
