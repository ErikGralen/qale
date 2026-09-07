import type { UseCaseContext } from '../ports.js';

/**
 * What the PO has waved off the sidebar's Meetings row (docs/sidebar-ia.md,
 * SB-6). That row shows up to three meetings starting soon; a dismissal hides
 * one occurrence, not the meeting for good — it falls back off the row on its
 * own once it starts. Kept in the check ledger, like the capture nudge's own
 * memory, so it survives a moved workspace. The two ledgers never read each
 * other: waving a meeting off the rail says nothing about its capture nudge.
 */

const DISMISS_PREFIX = 'sidebar-meeting:';

export interface SidebarMeetingState {
  dismissed: string[];
}

const EMPTY: SidebarMeetingState = { dismissed: [] };

export function sidebarMeetingState(ctx: UseCaseContext): SidebarMeetingState {
  const checks = ctx.checks;
  if (!checks) return EMPTY;
  return { dismissed: checks.list(DISMISS_PREFIX).map((r) => r.key.slice(DISMISS_PREFIX.length)) };
}

export function dismissSidebarMeeting(
  ctx: UseCaseContext,
  path: string,
  now: number,
): SidebarMeetingState {
  const checks = ctx.checks;
  if (!checks) return EMPTY;
  checks.set(`${DISMISS_PREFIX}${path}`, '1', now);
  return sidebarMeetingState(ctx);
}

export function undoSidebarMeeting(ctx: UseCaseContext, path: string): SidebarMeetingState {
  const checks = ctx.checks;
  if (!checks) return EMPTY;
  checks.remove(`${DISMISS_PREFIX}${path}`);
  return sidebarMeetingState(ctx);
}
