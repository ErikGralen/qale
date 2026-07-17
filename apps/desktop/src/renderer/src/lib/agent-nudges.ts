/**
 * Seed prompts for agent nudges that live inside their owning views (the
 * meeting page's prep brief, the Todos view's overdue triage). These used to
 * arrive as inbox pings; the prompt contracts moved here with them.
 */

/** Kick off the Before-Meeting session for one meeting page. */
export function beforeMeetingSeed(path: string): string {
  return `Run the Before-Meeting session on ${path}: read the participants' people pages (last_told), the customer/problem hubs this meeting touches, and the previous meeting in its series, then propose a ## Prep section for the meeting page as one approval card.`;
}

export interface OverdueTodoRef {
  path: string;
  title: string;
  due: string;
  /** The person a waiting-on commitment is owed by; absent for the PO's own. */
  owner?: string | null;
}

/** Kick off the librarian triage over every slipped commitment. */
export function overdueTriageSeed(own: OverdueTodoRef[], waiting: OverdueTodoRef[], today: string): string {
  const label = (n: OverdueTodoRef): string =>
    `- ${n.path} — ${n.title} (due ${n.due}${n.owner ? `, waiting on ${n.owner}` : ''})`;
  return `These commitments are past their due date (today is ${today}):\n\nMine:\n${
    own.map(label).join('\n') || '- (none)'
  }\n\nWaiting on others:\n${
    waiting.map(label).join('\n') || '- (none)'
  }\n\nFor each of mine: check whether the memory shows it already happened (search for it) — if so propose flipping status to done; otherwise ask me whether to reschedule or drop it. For each I'm waiting on: propose a short nudge draft I can send, citing where the commitment was made.`;
}
