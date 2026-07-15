/**
 * The built-in skill pack (PLAN-V2 §3.2) — shipped as content, seeded into a new
 * workspace's `skills/` folder and used as the fallback when a workspace hasn't
 * customised a session type. Editing the workspace copy overrides these.
 */

export const AFTER_MEETING_SKILL = `---
type: skill
skill_kind: session
session_type: after-meeting
summary: After-Meeting — turn a meeting into the truth delta as approval cards
tier: suggest
checkpoints: [digest, outline, draft]
gate_output: true
completion_bar: Every truth-delta item cites the transcript or prior memory; nothing asserted uncited.
stopping_conditions:
  - The meeting is flagged safe_space — do nothing, say the meeting was private.
red_flags:
  - A decision with no decider or date — ask before drafting it.
  - A claim that contradicts an existing decision or insight — flag it, do not overwrite.
---

## When
A meeting transcript is dropped, or the PM gives a 60-second typed debrief. The meeting isn't over
until the systems are updated.

## Read
The meeting note's transcript, plus the memory it touches: the customer page, the relevant problem
hub, and prior decisions (via search_vault). Follow superseded decisions to their live head.

## Produce
The truth delta, each item as one approval card citing its evidence:
- **Decisions** — what was decided, by whom, why (propose_decision). If it reverses an earlier
  decision, set \`supersedes\` to that decision's slug.
- **Insights** — cited claims about customers/problems with a confidence level (propose_note, type insight).
- **Actions / open questions / not-doings** — as updates to the meeting page and the relevant hub
  (propose_update). Existing tracker keys (e.g. ENG-214) appear as plain text; never invent links.
- **Who-needs-to-know** — update the relevant people pages' last_told ledger (propose_update).
- A **meeting summary** on the meeting page (propose_update) linking the decisions and insights.

## Then
Approved cards write the decision spine and insights, update the customer/problem/meeting hubs, and
advance the people last_told ledgers. Nothing reaches Jira/Confluence here — that is the outbound tier.
`;

export const ASK_SKILL = `---
type: skill
skill_kind: session
session_type: ask
summary: Ask — answer any question with a cited, dated answer, or "vet inte"
tier: observe
---

## When
Anytime — a question about the product, a customer, a decision, or what was said.

## Read
The whole workspace (search_vault, vault_read) and, when configured, live Jira/Confluence.

## Produce
A cited, dated answer. Cite workspace notes by path and external systems by their deep link. When a
decision was superseded, follow the chain and give the reason. If the evidence is thin (few insights,
one account, old), say so with honest confidence.

## Then
If there is no evidence, say "vet inte" (I don't know) rather than guessing. A good answer can be
saved as a golden answer for next time.
`;

export const CHAT_SKILL = `---
type: skill
skill_kind: session
session_type: chat
summary: Chat — think with your product memory
tier: observe
---

## When
Open-ended thinking — connections across meetings, decisions, insights and problems.

## Read
The workspace via search_vault and vault_read.

## Produce
Answers grounded in what the tools return, citing notes by path. No writes.

## Then
Nothing is written; surface what to formalise and the PM can run an After-Meeting or save a golden answer.
`;

export const FILING_RULES = `---
type: skill
skill_kind: filing
summary: Filing rules — where each typed object lives and how it links
---

# Filing rules

The librarian follows these when proposing paths and links (PLAN-V2 §3.1):

- **meetings/** — one file per meeting: \`YYYY-MM-DD-<slug>.md\`. Immutable transcript under
  \`## Transcript\`; the derived summary above it. Links to the decisions and insights it produced.
- **decisions/** — the append-only spine: \`YYYY-MM-DD-<slug>.md\`. Never edit a decision's body;
  supersede it (new file + \`supersedes\`, old file flipped to \`status: superseded\`).
- **insights/** — cited claims: \`<slug>.md\`, \`evidence[]\` required, a \`confidence\` level, a
  freshness clock. Link to the customer and problem they concern.
- **customers/** — one hub per account: commitments, signals, the what-they-were-told ledger.
- **problems/** — durable problem hubs; carry a \`stance\`; accrue evidence even when \`wont-do\`.
- **releases/** — what shipped, notes per audience.
- **people/** — stakeholders: what they care about, \`last_told\`.
- **sessions/** — replayable session receipts, written by the harness. Never hand-edited.

Every derived note lists its \`sources\`/\`evidence\` as wikilinks. Prefer linking to an existing hub
over creating a new file. Ticket keys and URLs are cited, never invented.
`;

export interface DefaultSkill {
  file: string;
  content: string;
}

export const DEFAULT_SKILLS: DefaultSkill[] = [
  { file: 'skills/after-meeting.md', content: AFTER_MEETING_SKILL },
  { file: 'skills/ask.md', content: ASK_SKILL },
  { file: 'skills/chat.md', content: CHAT_SKILL },
  { file: 'skills/_filing-rules.md', content: FILING_RULES },
];

/** Built-in skill content keyed by session_type (the runtime fallback). */
export const DEFAULT_SKILL_BY_TYPE: Record<string, string> = {
  'after-meeting': AFTER_MEETING_SKILL,
  ask: ASK_SKILL,
  chat: CHAT_SKILL,
};
