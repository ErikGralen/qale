import { fileSlug, isIndexableNote, type SessionFrontmatter } from '@qale/domain';
import type { SessionHarness } from './harness.js';

/**
 * A path the receipt mentions, as a link where a link would work and as plain
 * text where it would not.
 *
 * A run reads orientation maps and its own working files, and neither is a note:
 * nothing indexes them, so `[[notes/index]]` is a link that can never resolve.
 * Writing it anyway put four or five permanently broken links into the workspace
 * per session, which the librarian then dutifully found. The receipt still says
 * exactly what was read; it just stops pretending those are pages.
 */
function mention(path: string): string {
  const slug = path.replace(/\.md$/, '');
  return isIndexableNote(path) ? `[[${slug}]]` : `\`${slug}\``;
}

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

  const cards = harness.writes.length;
  const frontmatter: SessionFrontmatter = {
    type: 'session',
    // Titled, because a receipt without one is named after its file, and its
    // file ends in a session id.
    title: `${harness.primarySkillTitle} session`,
    summary: `${cards === 0 ? 'No cards' : cards === 1 ? '1 card' : `${cards} cards`} proposed.`,
    skill: name,
    ...(harness.invoked.length > 0 ? { skills: harness.skillNames } : {}),
    session_id: harness.sessionId,
    started: harness.started,
    ended: now,
    // The frontmatter half is an edge list the index reads, so only real notes
    // belong in it. What was read and is not a note is still in the body below.
    reads: reads.filter(isIndexableNote).map((r) => `[[${r.replace(/\.md$/, '')}]]`),
    writes: [...new Set(writes)],
    ...(sourceMeeting ? { source_meeting: sourceMeeting } : {}),
  };

  const turns = harness.turns.length;
  const lines: string[] = [`# ${harness.primarySkillTitle} session`, ''];
  lines.push(`Started ${harness.started} · ${turns} ${turns === 1 ? 'turn' : 'turns'}`);
  // Which skills were in force, not just the one the session opened with — a
  // session that pulled in Synthesis halfway through says so (Sessions v2 Part 4).
  if (harness.invoked.length > 0) lines.push(`Skills: ${harness.skillTitles.join(' → ')}`);
  if (files > 0) lines.push(`Session files: ${files} (working material, not kept in the memory)`);
  lines.push('', '## Turns');
  for (const [i, turn] of harness.turns.entries()) {
    const n = turn.cardIds.length;
    lines.push(
      `${i + 1}. ${truncate(turn.prompt, 200)}${n ? ` (${n} ${n === 1 ? 'card' : 'cards'})` : ''}`,
    );
  }
  lines.push(
    '',
    '## Read',
    reads.length ? reads.map((r) => `- ${mention(r)}`).join('\n') : '_none_',
  );
  lines.push('', '## Proposed (approval cards)');
  lines.push(
    harness.writes.length
      ? harness.writes
          .map((w) => `- ${w.kind}: [[${w.path.replace(/\.md$/, '')}]] (${w.cardId})`)
          .join('\n')
      : '_none_',
  );

  return { path, frontmatter, body: lines.join('\n') + '\n' };
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
}
