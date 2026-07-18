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
bindings:
  - mode: triggered
    event: capture.transcript
    when:
      origin: po
completion_bar: Every truth-delta item cites the transcript or prior memory; nothing asserted uncited.
red_flags:
  - A decision with no decider or date — ask before drafting it.
  - A claim that contradicts an existing decision or insight — flag it, do not overwrite.
---

## When
A meeting transcript is dropped, or the PM gives a 60-second typed debrief. The meeting isn't over
until the systems are updated.

## Read
The meeting note and its transcript — follow the \`transcript\` frontmatter ref to the source note
(older meetings carry it inline under \`## Transcript\`) — plus the memory it touches: the customer
page, the relevant problem hub, and prior decisions (via search_vault). Follow superseded decisions
to their live head. If the meeting has a \`## Prep\` section, note which prep questions got answered.

## Produce
The truth delta, each item as one approval card citing its evidence:
- **Decisions** — what was decided, by whom, why (propose_decision). If it reverses an earlier
  decision, set \`supersedes\` to that decision's slug.
- **Insights** — cited claims about customers/problems with a confidence level (propose_note, type insight).
- **Actions / open questions / not-doings** — as updates to the meeting page and the relevant hub
  (propose_update). Existing tracker keys (e.g. ENG-214) appear as plain text; never invent links.
- **Commitments** — every "I'll …" becomes a todo card (propose_todo) citing the meeting, with the
  verbatim quote. The PM's own commitments get no owner; someone else's ("Jonas: I'll update the
  docs") set \`owner\` to that person. Date only if one was named or clearly implied. Check existing
  todos first (vault_list type "todo") and skip anything already tracked.
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

export const BEFORE_MEETING_SKILL = `---
type: skill
skill_kind: session
session_type: before-meeting
summary: Before-Meeting — the memory brief, written into the meeting page as prep
tier: suggest
completion_bar: Every prep line cites the memory it came from; nothing invented about people or accounts.
red_flags:
  - A "last told" claim with no ledger entry behind it — say the ledger is empty rather than guessing.
---

## When
A meeting is coming up — the PO asks "prep me for the 2pm", or the morning sweep finds an upcoming
meeting note (\`date\` today or later) without a \`## Prep\` section.

## Read
The meeting note, its participants' people pages (what they care about, \`last_told\`), the customer
hub and problem hubs it touches, prior decisions involving these people (follow superseded chains to
the live head), and — when the meeting has a \`series\` — the previous meeting in the series (open
actions, unanswered questions, what was promised).

## Produce
One approval card: a \`## Prep\` section on the meeting page (propose_update), as a brief the PO can
glance at in the meeting:
- **Since last time** — what changed that these participants have not been told (\`last_told\` vs the
  decision spine and releases). Flag decisions they may still believe in superseded form.
- **Open questions** — pulled from the hubs' open-question lists, as checkboxes; asking them closes
  loops in memory. Cite each question's source.
- **Loose ends** — unresolved actions and commitments from the previous meeting in the series.
- **Landmines** — anything promised externally that the spine contradicts.
Keep it under a screen. Every line cites its wikilink.

## Then
The approved prep lands on the meeting page — it doubles as the in-meeting crib sheet, and
After-Meeting later checks which prep questions were answered.
`;

export const EXTERNAL_TRANSCRIPT_SKILL = `---
type: skill
skill_kind: session
session_type: external-transcript
summary: External-Transcript — mine a meeting the PO was NOT in for signals, never decisions
tier: suggest
bindings:
  - mode: triggered
    event: capture.transcript
    when:
      origin: external
completion_bar: Every extracted claim quotes the transcript verbatim; interpretation is marked with an honest confidence.
stopping_conditions:
  - The transcript is empty or content-free — say so and propose nothing.
red_flags:
  - Anything that reads like a product decision — a colleague's call CANNOT create product truth. Never propose_decision from an external transcript.
  - A commitment made on the product's behalf ("we told them SCIM lands in Q3"), especially one the decision spine contradicts — surface it as its own card marked "commitment made externally — confirm or correct", never file it silently.
---

## When
A transcript of a meeting the PO did not attend lands in sources/ — a colleague's sales call, a
forwarded customer conversation. The PO is a reader, not a participant: this is signal to mine,
not a meeting to process.

## Read
The source note (its \`origin\` says whose meeting it was), the customer page it concerns, the
problem hubs and existing insights it touches, and the decision spine for anything the conversation
contradicts (search_vault).

## Produce
Approval cards — insights and hub updates ONLY, never decisions:
- **Insights** — cited claims about the customer/problem (propose_note, type insight), each quoting
  the transcript. The verbatim customer voice is strong evidence; what is secondhand is the
  interpretation, so set confidence honestly on the claim, not reflexively low.
- **Customer signals** — updates to the customer hub (propose_update) where the call genuinely adds
  signal (pain points, competitors named, feature asks).
- **External commitments** — if the colleague promised something, a todo card (propose_todo) with
  \`owner\` set to that colleague and the verbatim quote; when it contradicts the spine, say so
  plainly in the card's rationale.
- **Who was told what** — if the colleague shared product news, advance the relevant people/customer
  \`last_told\` ledger (propose_update) attributing who said it.

## Then
Approved cards wire the signal into memory; the source flips new → processed when an accepted card
cites it. The transcript stays in sources/ as cold, verbatim evidence for provenance walks.
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
A cited, dated answer. Cite workspace notes as wikilinks (so they are clickable) and external systems
by their deep link. When a decision was superseded, follow the chain and give the reason. If the
evidence is thin (few insights, one account, old), say so with honest confidence.

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
Answers grounded in what the tools return, citing notes as wikilinks. No writes.

## Then
Nothing is written; surface what to formalise and the PM can run an After-Meeting or save a golden answer.
`;

export const INTAKE_SKILL = `---
type: skill
skill_kind: session
session_type: intake
summary: Intake — figure out what a capture is, connect it to the memory, propose the filing
tier: suggest
bindings:
  - mode: triggered
    event: capture.ingested
    when:
      kind: link
  - mode: triggered
    event: capture.ingested
    when:
      kind: screenshot
completion_bar: Every proposed link or note cites the capture or existing memory; unclear points are asked, not assumed.
stopping_conditions:
  - The capture is empty or content-free — say so and propose nothing.
red_flags:
  - A capture that is actually a meeting transcript — participation decides its path. If the PO was in the room, suggest re-filing it as a meeting (After-Meeting). If not, it stays a source; suggest the External-Transcript session instead.
  - A claim from an article or screenshot asserted as product truth — file it as a cited signal with its source and an honest confidence, never as fact.
---

## When
Something lands in the workspace that isn't a meeting transcript: an article link, a screenshot with
a caption, a pasted thread, a stray thought worth filing. The PO dumped it; deciding what it is and
where it belongs is the system's job.

## Read
The capture itself (a raw source in sources/, or a quick note), then the memory it might touch:
search_vault for the customers, problems, insights and decisions it relates to. For a link, work from
the URL and whatever the PO pasted with it — do not invent what the page says. For a screenshot, work
from the caption; the image itself is evidence on disk, not something you can read.

## Produce
The smallest set of approval cards that wires the capture into the memory. A raw source's body is
immutable — never propose edits to it; wire it in from the other side:
- Update the hubs it concerns (propose_update adding wikilinks to the capture) where it genuinely
  adds signal.
- If it carries a claim — an article's finding, a screenshot's statement, a competitor move — propose
  an insight (propose_note, type insight) citing the capture and its source, with a confidence level.
- If it names a person or customer with no page yet, ask before creating one.
If you cannot tell what the capture is for, ask one concrete question instead of guessing.

## Then
Approved cards connect the capture into the memory; unclear captures get resolved in this
conversation. The capture file itself stays as the raw source — approving a card that cites it flips
its status from new to processed.
`;

export const FILING_RULES = `---
type: skill
skill_kind: filing
summary: Filing rules — where each typed object lives and how it links
---

# Filing rules

The librarian follows these when proposing paths and links (PLAN-V2 §3.1):

- **sources/** — raw dumped material (article links, screenshots, pasted threads, synced pages,
  meeting transcripts, and transcripts of meetings the PO was NOT in): \`YYYY-MM-DD-<slug>.md\`.
  The body is never edited, only re-synced from upstream. Carries a lifecycle \`status\` (enum:
  new/processed/active/stale) — \`new\` until an approved card cites it. An external meeting's
  transcript sets \`origin\` (whose meeting it was); it is a signal, never a meeting.
- **meetings/** — one file per meeting the PO was IN: \`YYYY-MM-DD-<slug>.md\`. The single anchor
  for the whole lifecycle: \`## Prep\` (before), \`## Notes\` (during), \`## Summary\` (processed —
  links the decisions and insights it produced). The immutable transcript lives in sources/ and is
  linked via the \`transcript\` frontmatter ref. Recurring meetings share a \`series\` slug.
  Carries the lifecycle \`status\`: \`new\` until After-Meeting's cards land. A meeting whose
  \`date\` is in the future is upcoming — derived, never a status value.
- **decisions/** — the append-only spine: \`YYYY-MM-DD-<slug>.md\`. Never edit a decision's body;
  supersede it (new file + \`supersedes\`, old file flipped to \`status: superseded\`).
- **insights/** — cited claims: \`<slug>.md\`, \`evidence[]\` required, a \`confidence\` level.
  Link to the customer and problem they concern.
- **customers/** — one hub per account: commitments, signals, the what-they-were-told ledger.
- **problems/** — durable problem hubs; carry a \`stance\`; accrue evidence even when \`wont-do\`.
- **releases/** — what shipped, notes per audience.
- **people/** — stakeholders: what they care about, \`last_told\`.
- **todos/** — the commitment ledger: one file per commitment, \`YYYY-MM-DD-<slug>.md\`. Carries
  \`status\` (open/done/dropped), optional \`due\`, and \`owner\` only when someone other than the PO
  owes it (a waiting-on item). \`sources[]\` cite where the commitment was made. Closed todos stay.
- **notes/** — quick authored captures (stray thoughts, ⌘N notes); dumped external material goes
  to sources/ instead. Intake proposes how each connects into the memory.
- **attachments/** — dropped images/screenshots, each referenced by a capture note in sources/.
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
completion_bar: Every line in every update is cited by a wikilink or a deep link.
stopping_conditions:
  - Nothing material changed this week — say so and produce nothing.
red_flags:
  - An update that restates old news — only include this week's genuine deltas.
---

## When
Scheduled (Friday 15:00), or on demand. Also runs as a dry-run against last week before enabling.

## Read
The week's deltas across memory — recent meetings, new/superseded decisions, new insights — and,
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
bindings:
  - mode: forced
    audience: executives
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
bindings:
  - mode: forced
    audience: customers
---

# Voice: customer success

- Say what changes for the customer and by when. Be concrete about commitments.
- Warm but precise; never over-promise. If a date is uncertain, say so.
- Always link the decision or release that backs the claim.
- Banned phrases: "should be fine", "soon", "we're working on it" (without a date).
`;

export const LIBRARIAN_SKILL = `---
type: skill
skill_kind: session
session_type: librarian
summary: Librarian — repair and tidy the memory, everything as approval cards
tier: suggest
red_flags:
  - A repair that would change a claim's meaning — flag it and ask, never silently rewrite truth.
  - Deleting anything — propose it plainly and let the PO decide; the librarian never destroys.
---

## When
The maintenance sweep noticed something worth a conversation — broken links, orphans with no place
in the memory — and the PO opened the ping.

## Read
The flagged notes first, then whatever they touch: the notes that cite them, the sources they cite,
and newer meetings/insights that may have superseded their claims (search_vault, vault_read).

## Produce
Small, reviewable repairs — each as its own approval card:
- **Link repairs** — propose_update fixing a broken wikilink to its intended target. If no target
  exists, say so and let the PO choose between creating it and dropping the link.
- **Adoptions** — for orphans, propose_update linking them into the right hub, or say plainly that a
  note is noise and name it for deletion (the PO deletes; you never do).

## Then
Approved cards mend the memory's fiber. Anything you were unsure about stays a question in the chat,
not a card.
`;

export interface DefaultSkill {
  file: string;
  content: string;
}

export const DEFAULT_SKILLS: DefaultSkill[] = [
  { file: 'skills/after-meeting.md', content: AFTER_MEETING_SKILL },
  { file: 'skills/before-meeting.md', content: BEFORE_MEETING_SKILL },
  { file: 'skills/external-transcript.md', content: EXTERNAL_TRANSCRIPT_SKILL },
  { file: 'skills/ask.md', content: ASK_SKILL },
  { file: 'skills/chat.md', content: CHAT_SKILL },
  { file: 'skills/intake.md', content: INTAKE_SKILL },
  { file: 'skills/weekly-update.md', content: WEEKLY_UPDATE_SKILL },
  { file: 'skills/sprint-review.md', content: SPRINT_REVIEW_SKILL },
  { file: 'skills/interview-synthesis.md', content: INTERVIEW_SYNTHESIS_SKILL },
  { file: 'skills/spec-review.md', content: SPEC_REVIEW_SKILL },
  { file: 'skills/librarian.md', content: LIBRARIAN_SKILL },
  { file: 'skills/_filing-rules.md', content: FILING_RULES },
  { file: 'skills/voice-exec.md', content: VOICE_EXEC },
  { file: 'skills/voice-cs.md', content: VOICE_CS },
];

/** Built-in skill content keyed by session_type (the runtime fallback). */
export const DEFAULT_SKILL_BY_TYPE: Record<string, string> = {
  'after-meeting': AFTER_MEETING_SKILL,
  'before-meeting': BEFORE_MEETING_SKILL,
  'external-transcript': EXTERNAL_TRANSCRIPT_SKILL,
  ask: ASK_SKILL,
  chat: CHAT_SKILL,
  intake: INTAKE_SKILL,
  'weekly-update': WEEKLY_UPDATE_SKILL,
  'sprint-review': SPRINT_REVIEW_SKILL,
  'interview-synthesis': INTERVIEW_SYNTHESIS_SKILL,
  'spec-review': SPEC_REVIEW_SKILL,
  librarian: LIBRARIAN_SKILL,
};
