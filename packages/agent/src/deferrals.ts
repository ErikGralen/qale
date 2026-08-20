import { Type } from 'typebox';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { recordDeferral, type UseCaseContext } from '@qale/application';

/**
 * `record_deferral` (OW6) — the one line a run leaves when it identified
 * something and deliberately chose not to cover it this pass.
 *
 * Bookkeeping, not authorship. It writes no note, proposes nothing and decides
 * nothing about the memory; it records that a decision was made, so the next
 * run meets "this was left, and here is why" instead of rediscovering the same
 * area or never seeing it again. That is why it needs no approval card, and why
 * it is registered on every session rather than earned by a capability the way
 * `file_material` is: a session that can already put a card in front of the PM
 * loses nothing by also being able to say "not this one, because".
 *
 * The reason is read back into a LATER prompt (the librarian's next worklist),
 * which is the whole point and also the risk OW9 audits. The application layer
 * flattens it to one line and caps it before it is stored, and the worklist says
 * out loud that the block is an earlier pass's own notes rather than
 * instructions. Both halves belong together; neither is enough alone.
 */

export const DEFER_TOOL_NAME = 'record_deferral';

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }], details: undefined };
}

export function createDeferralTool(
  ctx: UseCaseContext,
  now: () => number = Date.now,
): ToolDefinition {
  return defineTool({
    name: DEFER_TOOL_NAME,
    label: 'Record a deferral',
    description:
      'Write down that you identified something and are deliberately NOT covering it this pass, so the ' +
      'next run sees it instead of rediscovering it or losing it. Use it for anything you decided to ' +
      'leave: a finding you ran out of room for, a repair you could not ground yet, an area whose ' +
      'evidence has not arrived. Do not let the backlog grow silently: every area you identified is ' +
      'either covered or has a deferral entry with a reason. One entry per note, one short sentence of ' +
      'reason ("waiting on the Q3 interviews", "two plausible targets, needs the PM"). It writes ' +
      'nothing to the memory and proposes nothing, so it needs no approval. It is not a substitute for ' +
      'doing the work, and it is not a place to leave a message for yourself: the entry disappears on ' +
      'its own once a card against that note is approved.',
    parameters: Type.Object({
      note: Type.String({
        description: 'The note this is about, as a path or slug (e.g. "notes/rollout-plan.md").',
      }),
      reason: Type.String({
        description: 'One short sentence: why it is being left, and what would let it be covered.',
      }),
    }),
    async execute(_id, params: { note: string; reason: string }) {
      const result = recordDeferral(ctx, { note: params.note, reason: params.reason }, now());
      if (!result.ok) return text(`Not recorded: ${result.error}`);
      return text(
        `${result.replaced ? 'Updated the deferral on' : 'Deferred'} ${result.notePath}: "${result.reason}". ` +
          `A later pass sees this on its worklist, and it clears itself once a card against that note is approved.`,
      );
    },
  });
}
