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
tier: outbound
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

Then, for the actions and who-needs-to-know items, draft the outbound follow-ups as cards:
- **Jira drafts** — actions become draft_jira_issue cards (never created until approved), citing the
  meeting; set linkBack to the meeting page so the deep link files back on approval.
- **Confluence / per-audience** — a meeting summary can become a draft_confluence_update; who-needs-to-
  know items become draft_message cards per audience (CS/sales/exec), filed under the person/customer.
Apply the voice guides when drafting outbound. Outbound is draft-and-approve, forever.

## Then
Approved internal cards write the decision spine and insights and update the customer/problem/meeting
hubs; approved outbound cards create the Jira issue / Confluence update and file the deterministic link
back. Who-needs-to-know updates the people last_told ledger.
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

export const WEEKLY_UPDATE_SKILL = `---
type: skill
skill_kind: session
session_type: weekly-update
summary: Weekly Update — the week's deltas as per-audience update drafts
tier: outbound
checkpoints: [scan, outline, draft]
gate_output: true
completion_bar: Every line in every update is cited by a workspace path or a deep link.
stopping_conditions:
  - Nothing material changed this week — say so and produce nothing.
red_flags:
  - An update that restates old news — only include this week's genuine deltas.
---

## When
Scheduled (Friday 15:00), or on demand. Also runs as a dry-run against last week before enabling.

## Read
The week's deltas across memory — recent meetings, new/superseded decisions, fresh insights — and,
when configured, the Jira sprint delta. Use search_vault and the "This week" lens as your scope.

## Produce
A per-audience update draft (exec, CS, team), every claim cited:
- Exec: outcomes and decisions, three lines (draft_message audience: exec) — apply the exec voice.
- CS: what changes for customers and when (draft_message audience: cs) — apply the CS voice.
- Team: shipped / slipped / why, linking the decisions and releases (draft_confluence_update or a note).

## Then
Everything is held in the Inbox for approval — nothing is sent. Approved message drafts file under
the relevant people/customers; Confluence drafts push on approval with the deep link filed back.
`;

export const SPRINT_REVIEW_SKILL = `---
type: skill
skill_kind: session
session_type: sprint-review
summary: Sprint Review — walk shipped/slipped/why, draft release notes per audience
tier: outbound
checkpoints: [scan, outline, draft]
gate_output: true
completion_bar: Every shipped/slipped item links its decision or release; nothing uncited.
red_flags:
  - "Slipped" with no reason — find the why before drafting.
---

## When
End of sprint, or on demand.

## Read
The sprint's Jira delta (jira_search), the sprint's meetings and the decisions that touched them.

## Produce
A walkthrough of shipped / slipped / why, and release notes per audience — as approval cards
(propose_note for a release, draft_confluence_update for the release page, draft_message per audience).

## Then
Approved cards update the release page and file per-audience notes. Nothing is sent.
`;

export const INTERVIEW_SYNTHESIS_SKILL = `---
type: skill
skill_kind: session
session_type: interview-synthesis
summary: Interview Synthesis — turn a customer call into insights, flag contradictions
tier: suggest
checkpoints: [digest, outline, draft]
gate_output: true
completion_bar: Every insight cites the transcript; contradictions with existing beliefs are flagged.
red_flags:
  - An insight that contradicts an existing insight or decision — flag it, never overwrite.
---

## When
A customer-call transcript is dropped.

## Read
The transcript, the customer page, and the problems it touches (search_vault).

## Produce
Signals and insights as approval cards (propose_note type insight), each citing the transcript and a
confidence level. Where a finding contradicts an existing belief, flag it as an update to the relevant
insight/problem (propose_update) — never resolve silently.

## Then
Approved cards update the customer and insight pages; contradictions surface for the PM to resolve.
`;

export const SPEC_REVIEW_SKILL = `---
type: skill
skill_kind: session
session_type: spec-review
summary: Spec Review — requirements draft + gap list from everything that touched an epic
tier: suggest
checkpoints: [gather, outline, draft]
gate_output: true
completion_bar: Every requirement line is cited by a meeting, decision or thread; gaps are explicit.
red_flags:
  - A requirement with no source — move it to the open-questions list instead of asserting it.
---

## When
An epic is linked for review.

## Read
The epic (jira_get_issue) and every meeting, thread and decision that touched it (search_vault).

## Produce
A requirements draft + a gap list + open questions, every line cited (propose_note or a
draft_jira_comment on the epic). Unsourced items go to open questions, not requirements.

## Then
Approved cards draft the epic comment and file the requirements note. Nothing is asserted uncited.
`;

export const VOICE_EXEC = `---
type: skill
skill_kind: voice
summary: Exec voice — outcomes and decisions, no process
---

# Voice: executive

- Lead with the outcome and the decision, not the process.
- Three sentences max. No hedging, no jargon.
- Quantify when you can (dates, counts, revenue at risk).
- Banned phrases: "just wanted to", "circle back", "synergy", "leverage" (as a verb), "touch base".
`;

export const VOICE_CS = `---
type: skill
skill_kind: voice
summary: CS voice — what changes for the customer, and when
---

# Voice: customer success

- Say what changes for the customer and by when. Be concrete about commitments.
- Warm but precise; never over-promise. If a date is uncertain, say so.
- Always link the decision or release that backs the claim.
- Banned phrases: "should be fine", "soon", "we're working on it" (without a date).
`;

export interface DefaultSkill {
  file: string;
  content: string;
}

export const DEFAULT_SKILLS: DefaultSkill[] = [
  { file: 'skills/after-meeting.md', content: AFTER_MEETING_SKILL },
  { file: 'skills/ask.md', content: ASK_SKILL },
  { file: 'skills/chat.md', content: CHAT_SKILL },
  { file: 'skills/weekly-update.md', content: WEEKLY_UPDATE_SKILL },
  { file: 'skills/sprint-review.md', content: SPRINT_REVIEW_SKILL },
  { file: 'skills/interview-synthesis.md', content: INTERVIEW_SYNTHESIS_SKILL },
  { file: 'skills/spec-review.md', content: SPEC_REVIEW_SKILL },
  { file: 'skills/_filing-rules.md', content: FILING_RULES },
  { file: 'skills/voice-exec.md', content: VOICE_EXEC },
  { file: 'skills/voice-cs.md', content: VOICE_CS },
];

/** Built-in skill content keyed by session_type (the runtime fallback). */
export const DEFAULT_SKILL_BY_TYPE: Record<string, string> = {
  'after-meeting': AFTER_MEETING_SKILL,
  ask: ASK_SKILL,
  chat: CHAT_SKILL,
  'weekly-update': WEEKLY_UPDATE_SKILL,
  'sprint-review': SPRINT_REVIEW_SKILL,
  'interview-synthesis': INTERVIEW_SYNTHESIS_SKILL,
  'spec-review': SPEC_REVIEW_SKILL,
};
