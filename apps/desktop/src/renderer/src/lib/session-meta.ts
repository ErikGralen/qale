/** Display names for session types (skills). Unknown types prettify their slug. */
const SESSION_LABEL: Record<string, string> = {
  chat: 'Chat',
  ask: 'Ask',
  'after-meeting': 'After-Meeting',
  'before-meeting': 'Before-Meeting',
  'external-transcript': 'External transcript',
  intake: 'Intake',
  'weekly-update': 'Weekly Update',
  'sprint-review': 'Sprint Review',
  'interview-synthesis': 'Interview Synthesis',
  'spec-review': 'Spec Review',
  librarian: 'Librarian',
};

export function sessionLabel(type: string): string {
  return SESSION_LABEL[type] ?? type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}
