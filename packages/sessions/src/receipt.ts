import { fileSlug, type SessionFrontmatter } from '@pm/domain';
import type { SessionHarness } from './harness.js';

/**
 * The filed session transcript (PLAN-V2 §3.2) — the human-auditable receipt in
 * `sessions/`. The pi JSONL is the machine replay store; this is the reads/writes
 * ledger you open when trust needs checking. Deterministic, rebuilt each turn.
 */
export interface SessionReceipt {
  path: string;
  frontmatter: SessionFrontmatter;
  body: string;
}

export function buildSessionReceipt(
  harness: SessionHarness,
  now: string,
  sourceMeeting?: string,
  /**
   * How many working files the session wrote (Sessions v2 Part 1). Session files
   * are never committed and never swept, so this count is the only trace they
   * leave in the git-tracked record once nobody remembers running the session.
   */
  files = 0,
): SessionReceipt {
  const date = harness.started.slice(0, 10);
  const name = harness.primarySkillName;
  const path = `sessions/${date}-${fileSlug(name, date).replace(/^\d{4}-\d{2}-\d{2}-/, '')}-${harness.sessionId.slice(0, 8)}.md`;

  const reads = [...harness.reads];
  const writes = harness.writes.map((w) => `[[${w.path.replace(/\.md$/, '')}]]`);

  const frontmatter: SessionFrontmatter = {
    type: 'session',
    summary: `${name} session — ${harness.writes.length} card(s) proposed`,
    skill: name,
    ...(harness.invoked.length > 0 ? { skills: harness.skillNames } : {}),
    session_id: harness.sessionId,
    started: harness.started,
    ended: now,
    reads: reads.map((r) => `[[${r.replace(/\.md$/, '')}]]`),
    writes: [...new Set(writes)],
    ...(sourceMeeting ? { source_meeting: sourceMeeting } : {}),
  };

  const lines: string[] = [`# ${name} session`, ''];
  lines.push(`Started ${harness.started} · ${harness.turns.length} turn(s)`);
  // Which skills were in force, not just the one the session opened with — a
  // session that pulled in Synthesis halfway through says so (Sessions v2 Part 4).
  if (harness.invoked.length > 0) lines.push(`Skills: ${harness.skillNames.join(' → ')}`);
  if (files > 0) lines.push(`Session files: ${files} (working material, not kept in the memory)`);
  lines.push('', '## Turns');
  for (const [i, turn] of harness.turns.entries()) {
    lines.push(`${i + 1}. ${truncate(turn.prompt, 200)}${turn.cardIds.length ? ` — ${turn.cardIds.length} card(s)` : ''}`);
  }
  lines.push('', '## Read', reads.length ? reads.map((r) => `- [[${r.replace(/\.md$/, '')}]]`).join('\n') : '_none_');
  lines.push('', '## Proposed (approval cards)');
  lines.push(
    harness.writes.length
      ? harness.writes.map((w) => `- ${w.kind}: [[${w.path.replace(/\.md$/, '')}]] (${w.cardId})`).join('\n')
      : '_none_',
  );

  return { path, frontmatter, body: lines.join('\n') + '\n' };
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
