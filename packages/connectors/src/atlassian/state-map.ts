import type { StateCategory } from '@pm/domain';

/**
 * Jira workflow label → generic state_category. Uses the API's own
 * `statusCategory` field ('new' | 'indeterminate' | 'done') so custom workflows
 * ("Väntar på granskning") land correctly without us knowing their words.
 *
 * 'blocked' is the one category Jira doesn't model: its Flagged field is a
 * per-site custom field we can't rely on, so detection is a label heuristic on
 * the status name. Deliberately narrow — "Waiting for review" is normal
 * in-progress flow, not blockage; a miss shows as in_progress, never as a wrong
 * loud state.
 */
const BLOCKED_LABEL = /\b(blocked|blocker|blockerad|impediment|impeded|on[ -]hold|stalled)\b/i;

export function mapJiraStateCategory(rawState: string, categoryHint?: string | null): StateCategory {
  // Done wins over the label heuristic: "Closed — Blocked" is a RESOLVED ticket
  // whose name remembers why it once stalled; done is Jira's own verdict and a
  // finished ticket must never surface as a live blocker.
  if (categoryHint === 'done') return 'done';
  if (BLOCKED_LABEL.test(rawState)) return 'blocked';
  if (categoryHint === 'indeterminate') return 'in_progress';
  // 'new', undefined, or an unknown future key: the safe floor is open.
  return 'open';
}
