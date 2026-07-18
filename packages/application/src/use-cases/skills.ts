import {
  parseSkill,
  describeBinding,
  bindingMatches,
  type SkillConfig,
  type SkillEvent,
} from '@pm/sessions';
import type { UseCaseContext } from '../ports.js';

/**
 * Skills v2 (PLAN-V2 §skills) — the read + trigger layer behind the Skills view
 * and the runtime's event dispatch. Skill files are markdown notes in `skills/`;
 * this parses them and answers "what fires on this event". (Auto-apply of cards is
 * out of scope for MVP — every produced card is approved by the PO.)
 */

export interface SkillBindingView {
  mode: 'forced' | 'triggered' | 'dynamic';
  event?: string;
  /** Plain-language sentence for the Skills view. */
  sentence: string;
}

/** A parsed skill as the Skills view's row sees it. */
export interface SkillSummary {
  path: string;
  slug: string;
  name: string;
  kind: SkillConfig['kind'];
  summary: string;
  tier: SkillConfig['tier'];
  bindings: SkillBindingView[];
  errors: string[];
  mtime: number;
}

/** Every skill file, parsed for the Skills view. */
export async function listSkills(ctx: UseCaseContext): Promise<SkillSummary[]> {
  const indexed = ctx.index.all().filter((n) => n.type === 'skill');
  const out: SkillSummary[] = [];
  for (const n of indexed) {
    const raw = (await ctx.vault.readRaw(n.path)) ?? '';
    const config = parseSkill(raw, n.slug);
    out.push({
      path: n.path,
      slug: n.slug,
      name: config.name,
      kind: config.kind,
      summary: config.summary,
      tier: config.tier,
      bindings: config.bindings.map((b) => ({
        mode: b.mode,
        event: b.event,
        sentence: describeBinding(b, config.kind),
      })),
      errors: config.errors,
      mtime: n.mtime,
    });
  }
  return out;
}

export interface TriggeredSkill {
  /** The skill name (session type) to fire. */
  sessionType: string;
  slug: string;
}

/**
 * Which skills a workspace event fires (the trigger dispatcher). Pure over the
 * index + parsed bindings; the caller (main) turns each hit into a headless
 * session that produces approval cards. Only session/reaction skills dispatch —
 * a stray triggered binding on a voice/guide/filing skill is inert (and flagged
 * as a parse error). Loop guard is the caller's job: only user/scheduler-origin
 * events are dispatched, never a triggered session's own writes (depth 1,
 * PLAN-V2 §skills).
 */
export async function skillsForEvent(
  ctx: UseCaseContext,
  event: SkillEvent,
  payload: Record<string, unknown> = {},
): Promise<TriggeredSkill[]> {
  const indexed = ctx.index.all().filter((n) => n.type === 'skill');
  const hits: TriggeredSkill[] = [];
  for (const n of indexed) {
    const raw = (await ctx.vault.readRaw(n.path)) ?? '';
    const config = parseSkill(raw, n.slug);
    if (config.kind !== 'session' && config.kind !== 'reaction') continue;
    if (config.bindings.some((b) => bindingMatches(b, event, payload))) {
      hits.push({ sessionType: config.name, slug: n.slug });
    }
  }
  return hits;
}
