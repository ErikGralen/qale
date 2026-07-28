/**
 * Retired skills (Sessions v2 Part 5) — the four arrival skills that collapsed
 * into one, kept here VERBATIM as they last shipped.
 *
 * They are dead code on purpose. `ensureDefaultSkills` deletes a retired file
 * from a workspace only when its contents still match one of the versions we
 * shipped: if the PO edited theirs, it is theirs, and it keeps firing until they
 * say otherwise. Without these strings the only safe move would be to leave
 * every old copy in place, and a workspace would run both the old skill and the
 * new one on the same dropped transcript.
 *
 * `interview-synthesis` is not merged, it is killed. It fired on arrival and
 * produced INSIGHTS — an analytical judgment about one document read in
 * isolation, with nothing to weigh it against. That made the memory's automatic
 * intake its lowest-quality content while its highest-quality content needed a
 * human to go ask for it. Insights arrive later now, from a session with a
 * question and nine transcripts to weigh one against.
 */

const AFTER_MEETING_SKILL_V1 = `---
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
  - An outbound card the meeting does not force — draft tracker changes only when the meeting settles, dates or creates tracked work; never reflexively.
---

## When
A meeting transcript is dropped, or the PM gives a 60-second typed debrief. The meeting isn't over
until the systems are updated.

## Read
The meeting note and its transcript — follow the \`transcript\` frontmatter ref to the source note
(older meetings carry it inline under \`## Transcript\`) — plus the memory it touches: the customer
page, the relevant theme hub, and prior decisions (via search_vault). Follow superseded decisions
to their live head. If the meeting has a \`## Prep\` section, note which prep questions got answered.
When the meeting, its series or its hubs link tickets, read their mirror notes (tickets/) so
anything you say about delivery rests on current state, not memory of it.

## Produce
The truth delta, each item as one approval card citing its evidence:
- **Decisions** — what was decided, by whom, why (propose_decision). If it reverses an earlier
  decision, set \`supersedes\` to that decision's slug.
- **Insights** — cited claims about customers/themes with a confidence level (propose_note, type insight).
- **Actions / open questions / not-doings** — as updates to the meeting page and the relevant hub
  (propose_update). Tickets mirrored in the workspace (tickets/) are wikilinked to their mirror
  notes; keys with no mirror note stay plain text. Never invent keys or links.
- **Commitments** — every "I'll …" becomes a todo card (propose_todo) citing the meeting, with the
  verbatim quote. The PM's own commitments get no owner; someone else's ("Jonas: I'll update the
  docs") set \`owner\` to that person. Date only if one was named or clearly implied. Check existing
  todos first (vault_list type "todo") and skip anything already tracked.
- **Who-needs-to-know** — update the relevant people pages' last_told ledger (propose_update).
- A **meeting summary** on the meeting page (propose_update) linking the decisions and insights.

Tag every proposed note with 1–2 contexts (\`tags\`) drawn from tags already in use in the workspace;
a brand-new context must be named in the card's rationale ("new context: #x") per the filing rules.

Then draft the external consequences — ONLY where the meeting actually implies a tracker change;
most meetings imply none, and a card nobody needed is noise:
- **A comment on a linked ticket** (draft_jira_comment) — when the meeting settles, dates or changes
  something an existing ticket tracks. Read the ticket's mirror note first so the comment lands on
  its current state, not a stale memory of it.
- **A new ticket** (draft_jira_issue) — when the meeting produced tracked work no ticket covers.
- **A follow-up on the calendar** (draft_calendar_event) — ONLY when the meeting names a concrete
  next session ("let's reconvene next week", "book 30 with Tom"): draft the event with a real start
  time (RFC3339 with offset), the people it names as attendees, and a body that says what it's for.
  linkBack the meeting page so the created event files back. A vague "we should meet again" is not a
  booking — don't draft one.
- **Per-audience** — who-needs-to-know items become draft_message cards per audience (CS/sales/exec),
  filed under the person/customer; a meeting summary can become a wikipage update (draft_confluence_update).
Every outbound body ends with a provenance line — "Source: <meeting>, <date>" — and every card cites
its evidence (the meeting, the decision it rests on). Set linkBack to the meeting page so the created
key / deep link files back on approval. Apply the voice guides when drafting outbound. Outbound is
draft-and-approve, forever.

## Then
Approved internal cards write the decision spine and insights and update the customer/theme/meeting
hubs; approved outbound cards execute upstream — the ticket comment, the new ticket, the wikipage
update — and file the deterministic link back, and the mirror re-syncs on the next pull.
Who-needs-to-know updates the people last_told ledger.
`;

const EXTERNAL_TRANSCRIPT_SKILL_V1 = `---
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
theme hubs and existing insights it touches, and the decision spine for anything the conversation
contradicts (search_vault).

## Produce
Approval cards — insights and hub updates ONLY, never decisions:
- **Insights** — cited claims about the customer/theme (propose_note, type insight), each quoting
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

const INTAKE_SKILL_V1 = `---
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
search_vault for the customers, themes, insights and decisions it relates to. For a link, work from
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

const INTERVIEW_SYNTHESIS_SKILL_V1 = `---
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
The transcript, the customer page, and the themes it touches (search_vault).

## Produce
Signals and insights as approval cards (propose_note type insight), each citing the transcript and a
confidence level. Where a finding contradicts an existing belief, flag it as an update to the relevant
insight/theme (propose_update) — never resolve silently.

## Then
Approved cards update the customer and insight pages; contradictions surface for the PM to resolve.
One interview is one account. Turning several of these into a pattern is the Synthesis session's
job, not this one's — never promote a single call to a theme here.
`;

/**
 * Bodies a still-shipped skill used to have. A workspace copy that matches one
 * of these was never touched by the PO, so seeding may refresh it in place —
 * otherwise `chat` and `ask` would keep their pre-Sessions-v2 frontmatter
 * forever, and a base session in an existing workspace would silently have no
 * session files and no fan-out.
 */
export const CHAT_SKILL_V1 = `---
type: skill
skill_kind: session
session_type: chat
summary: Chat — think with your product memory
tier: observe
---

## When
Open-ended thinking — connections across meetings, decisions, insights and themes.

## Read
The workspace via search_vault and vault_read.

## Produce
Answers grounded in what the tools return, citing notes as wikilinks. No writes.

## Then
Nothing is written; surface what to formalise and the PM can run an After-Meeting or save a golden answer.
`;

export const ASK_SKILL_V1 = `---
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

/** One skill file the pack no longer ships, with every body it ever had. */
export interface RetiredSkill {
  file: string;
  /** Contents we shipped for this file. An exact match means the PO never touched it. */
  shipped: string[];
}

export const RETIRED_SKILLS: RetiredSkill[] = [
  { file: 'skills/after-meeting.md', shipped: [AFTER_MEETING_SKILL_V1] },
  { file: 'skills/external-transcript.md', shipped: [EXTERNAL_TRANSCRIPT_SKILL_V1] },
  { file: 'skills/intake.md', shipped: [INTAKE_SKILL_V1] },
  { file: 'skills/interview-synthesis.md', shipped: [INTERVIEW_SYNTHESIS_SKILL_V1] },
];
