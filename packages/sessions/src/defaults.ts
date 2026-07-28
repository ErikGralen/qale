/**
 * The built-in skill pack (PLAN-V2 §3.2) — shipped as content, seeded into a new
 * workspace's `skills/` folder and used as the fallback when a workspace hasn't
 * customised a session type. Editing the workspace copy overrides these.
 */


export const ARRIVAL_SKILL = `---
type: skill
skill_kind: session
session_type: arrival
summary: Arrival — extract what a dropped document needs you to ACT on, and wire it in
tier: suggest
checkpoints: [digest, delta]
gate_output: true
bindings:
  - mode: triggered
    event: capture.transcript
    when:
      origin: po
    tier: outbound
  - mode: triggered
    event: capture.transcript
    when:
      origin: external
    tier: suggest
  - mode: triggered
    event: capture.ingested
    when:
      kind: link
    tier: suggest
  - mode: triggered
    event: capture.ingested
    when:
      kind: screenshot
    tier: suggest
completion_bar: Every item quotes the document or cites prior memory; nothing asserted uncited, and anything you could not tell is asked rather than guessed.
stopping_conditions:
  - The document is empty or content-free — say so and propose nothing.
  - Nothing in it needs to happen and nothing in it contradicts the memory — say that plainly rather than manufacturing cards.
red_flags:
  - A decision with no decider or date — ask before drafting it; a spoken line is not a decision record yet.
  - A claim that contradicts a live decision or insight — flag it, never overwrite. This is the cheapest, highest-value thing you can find here.
  - Analysis. You are reading ONE document with nothing to weigh it against, which makes any pattern you think you see the weakest thing this system can produce. Insights, themes and stances come later, from a session with a question and a corpus.
  - A commitment made on the product's behalf by someone who is not the PM ("we told them SCIM lands in Q3") — surface it as its own card marked "commitment made externally — confirm or correct", never file it silently.
---

## When
Something landed: a transcript of a meeting the PM was in, a transcript of one they were not, a
link, a screenshot, a pasted thread. One skill handles all of them, because the branch is data —
who was in the room, and what kind of thing it is — not a mode the PM should have to pick.

Your job is **extraction**, never analysis. What is mechanically in this document that needs to
become an object? Commitments made, dates, decisions stated with a decider, people, the meeting
record, and anything contradicting what the memory currently holds. One document, no corpus, no
question needed. What it all *means* is a different session with nine documents and a question.

## Read
The document itself first — for a meeting, follow the \`transcript\` frontmatter ref to the source
note. Then only the memory it actually touches: the customer page, the theme hubs it names, live
decisions it might contradict (search_vault), and the mirror notes (tickets/) of any ticket it
references, so anything you say about delivery rests on current state.

For a link, work from the URL and whatever the PM pasted with it — never invent what the page says.
For a screenshot, work from the caption; the image is evidence on disk, not something you can read.

## Produce
The smallest set of approval cards that makes the document actionable. What you may propose depends
on **what the document is**, not on how this session was opened:

**A meeting the PM was in** (origin: po) — the full truth delta:
- **Decisions** made, with the decider and the reason (propose_decision). Set \`supersedes\` when it
  reverses an earlier one.
- **Commitments** — every "I'll …" becomes a todo (propose_todo) citing the meeting with the
  verbatim quote. The PM's own get no owner; someone else's set \`owner\` to that person. A date only
  if one was named or clearly implied. Check existing todos first (vault_list type "todo").
- **A meeting summary** on the meeting page (propose_update) and the hub updates it implies —
  actions, open questions, not-doings, and the people pages' \`last_told\` ledger.
- **The external consequences**, ONLY where the meeting actually forces one: a comment on a linked
  ticket that the meeting settles or dates (draft_jira_comment), a new ticket for tracked work no
  ticket covers (draft_jira_issue), a follow-up the meeting concretely booked (draft_calendar_event
  — "let's reconvene next week" with a real time, never a vague "we should meet again"). Most
  meetings force none, and a card nobody needed is noise. Every outbound body ends with a
  provenance line ("Source: <meeting>, <date>"), cites its evidence, and sets linkBack to the
  meeting page. Apply the voice guides. Outbound is draft-and-approve, forever.

**A meeting the PM was NOT in** (origin: external) — a colleague's sales call is signal, not truth:
- Commitments anyone made, as todos with \`owner\` set to that colleague and the verbatim quote.
- Customer signals onto the customer hub (propose_update) where the call genuinely adds one.
- Who was told what, onto the \`last_told\` ledger, attributing who said it.
- **Never a decision.** A colleague's call cannot create product truth — not because of which
  session this is, but because of what the document is. You do not have the tools to draft outbound
  here either; that is deliberate.

**A link, screenshot or pasted thread** — wire it in from the other side, since a raw source's body
is immutable and you must never propose edits to it:
- Update the hubs it concerns (propose_update adding wikilinks to the capture) where it adds signal.
- A commitment or a date hiding in it becomes a todo.
- If it names a person or customer with no page yet, ask before creating one.
- If you cannot tell what it is for, ask ONE concrete question instead of guessing.

Tag every proposed note with 1-2 contexts (\`tags\`) drawn from tags already in use; name any
brand-new context in the card's rationale.

## Then
Approved cards land the delta: the decision spine, the commitment ledger, the hubs, the meeting
page. Approved outbound executes upstream and files its link back. The source stays in sources/ as
cold, verbatim evidence, and flips new → processed when an accepted card cites it. What this
document MEANS, weighed against everything else, is a question for a later session.
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
hub and theme hubs it touches, prior decisions involving these people (follow superseded chains to
the live head), and — when the meeting has a \`series\` — the previous meeting in the series (open
actions, unanswered questions, what was promised). For tickets linked from the meeting, its series
or those hubs, read the mirror notes (tickets/): their \`state\` and \`remote_updated\`
are the delivery truth as of the last sync.

## Produce
One approval card: a \`## Prep\` section on the meeting page (propose_update), as a brief the PO can
glance at in the meeting:
- **Since last time** — what changed that these participants have not been told (\`last_told\` vs the
  decision spine and the shipped tickets). Flag decisions they may still believe in superseded form.
- **Delivery** — for tickets linked from this meeting series and its hubs: what moved since the
  previous meeting, straight from the mirror notes ("Since Jul 14: PAY-142 In Review → Blocked").
  Compare each mirror's \`state\` and \`remote_updated\` with the previous meeting's date; leave out
  tickets that didn't move. States come from mirrors only, never from memory.
- **Open questions** — pulled from the hubs' open-question lists, as checkboxes; asking them closes
  loops in memory. Cite each question's source.
- **Loose ends** — unresolved actions and commitments from the previous meeting in the series.
- **Landmines** — anything promised externally that the spine contradicts, or whose linked ticket
  sits blocked.
Keep it under a screen. Every line cites its wikilink.

## Then
The approved prep lands on the meeting page — it doubles as the in-meeting crib sheet, and
After-Meeting later checks which prep questions were answered.
`;


export const ASK_SKILL = `---
type: skill
skill_kind: session
session_type: ask
summary: Ask — answer any question with a cited, dated answer, or "vet inte"
tier: observe
bindings:
  - mode: dynamic
---

## When
Anytime — a question about the product, a customer, a decision, or what was said. Pull this in
mid-conversation when the PM stops thinking out loud and asks something that deserves a cited,
dated answer rather than a discussion.

## Read
The whole workspace (search_vault, vault_read) and, when configured, live Jira/Confluence.

## Produce
A cited, dated answer. Cite workspace notes as wikilinks (so they are clickable) and external systems
by their deep link. When a decision was superseded, follow the chain and give the reason. If the
evidence is thin (few insights, one account, old), say so with honest confidence.

## Then
If there is no evidence, say "vet inte" (I don't know) rather than guessing. If the answer is worth
keeping, propose it as a note or an insight citing what it rests on — that is the only way anything
lands in the memory.
`;

export const CHAT_SKILL = `---
type: skill
skill_kind: session
session_type: chat
summary: Chat — think with your product memory
tier: observe
session_files: true
---

## When
Every session starts here. This is what a conversation with the memory is before anything narrows
it: open-ended thinking, connections across meetings, decisions, insights and themes. When the work
turns into something a skill already describes, load that skill rather than improvising it.

## Read
The workspace via search_vault and vault_read.

## Produce
Answers grounded in what the tools return, citing notes as wikilinks. Nothing lands in the memory
here — but you have session files, so a question too big for one context ("read these nine
transcripts and tell me what's there") is worked in the folder rather than refused: write a brief,
then a file per source, then answer from those.

## Then
Nothing is written to the memory; surface what is worth formalising and the PM can pull in a skill
that proposes it.
`;


export const PROCESS_NOTE_SKILL = `---
type: skill
skill_kind: session
session_type: process-note
summary: Process Note — work a rough dump into the memory; clean the note, update what it touches, create what it implies
tier: suggest
bindings:
  - mode: dynamic
completion_bar: The cleaned note says exactly what the dump said — nothing invented, nothing dropped; every card beyond the note itself cites it; every wikilink points at a page that exists.
stopping_conditions:
  - The note is already processed and nothing was added since the last run — say so and propose nothing.
red_flags:
  - A fragment you cannot confidently interpret — keep it verbatim and ask, never guess what the PO meant.
  - A decision heard with no decider — ask before drafting it; a dump line is not a decision record yet.
  - A claim that contradicts an existing decision or insight — flag it, do not overwrite.
---

## When
The PO dumped rough text into a note — half-sentences from a call, a day's running log — and hit
"Process" on the note page. Re-runs are normal: yesterday's processed notes with today's raw
additions at the bottom.

## Read
The note itself first. Then the memory it touches: search_vault for the people, customers, themes
and decisions the dump mentions. Existing wikilinks in the note mean an earlier run already
wired those parts in — leave them alone; focus on what is new or still raw.

## Produce
The full ripple of the dump, each piece its own approval card:
- **The note itself** — ONE propose_update: fix typos and half-sentences, group related lines under
  short headings, and turn plain-text mentions into wikilinks to pages that exist. This part is a
  copy edit, not a rewrite — preserve the PO's wording and meaning, never add content the dump does
  not carry. If the note is untitled (or its title no longer fits), set the card's \`title\` to a
  short descriptive one.
- **Other notes the dump impacts** — propose_update on each: the customer/theme hub it adds signal
  to, an open question elsewhere it answers, a people page's \`last_told\` when it says who was told
  what, a page whose claim it contradicts (flag, never overwrite).
- **New notes the dump implies** — commitments heard become todos (propose_todo, \`owner\` when it is
  someone else's); claims worth keeping become insights (propose_note type insight); a real decision
  with a decider becomes a decision card (propose_decision). Every new note cites this one.
- If a fragment is ambiguous, ask one concrete question instead of guessing.

## Then
Approved cards clean the note and propagate it: hubs updated, loops closed, new todos/insights/
decisions filed. The note stays the PO's scratch pad — more gets dumped, the button gets hit again,
and only the new material is touched.
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
  Link to the customer and theme they concern.
- **customers/** — one hub per account: commitments, signals, the what-they-were-told ledger.
- **themes/** — the durable things worth solving: a problem, a pain, an opportunity, an idea.
  Carry a \`stance\` (exploring / watching / committed / wont-do) and accrue evidence even when
  \`wont-do\` — the declined ones are exactly the ones whose reasoning is expensive to rebuild.
  A theme is never required to have a ticket, and a ticket is never required to have a theme.
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
  - A shipped/slipped/blocked claim no ticket mirror backs — delivery lines come from ticket state, not recall.
---

## When
Scheduled (Friday 15:00), or on demand. Also runs as a dry-run against last week before enabling.

## Read
The week's deltas across memory — recent meetings, new/superseded decisions, new insights — and the
week's delivery facts: ticket mirror notes (vault_list type "ticket") whose \`remote_updated\` falls
in the week. Their state transitions are what actually shipped, slipped or got blocked; report what
the mirrors show, never remembered status. Use search_vault and the "This week" lens as your scope.

## Produce
A per-audience update draft (exec, CS, team), every claim cited:
- Exec: outcomes and decisions, three lines (draft_message audience: exec) — apply the exec voice.
- CS: what changes for customers and when (draft_message audience: cs) — apply the CS voice.
- Team: shipped / slipped / why — grounded in the week's actual ticket transitions (what went done,
  what went blocked), linking the decisions and ticket mirrors (draft_confluence_update
  or a note).
Where the update has a wikipage home — a status or update page mirrored in wikipages/ and linked
from the memory — offer publishing there as its own card: a draft_confluence_update against that
page, ending with a provenance line ("Source: weekly update, <date>").

## Then
Everything is held in the Inbox for approval — nothing is sent. Approved message drafts file under
the relevant people/customers; approved wikipage updates push upstream with the deep link filed back
and the mirror re-syncs on the next pull.
`;


export const SYNTHESIS_SKILL = `---
type: skill
skill_kind: session
session_type: synthesis
summary: Synthesis — read a corpus, work out what it adds up to, and say what we now believe
tier: outbound
checkpoints: [scope, read, cluster, draft]
gate_output: true
session_files: true
bindings:
  - mode: dynamic
completion_bar: Every claim names the sources it rests on and how many distinct accounts back it; every source in scope got a pass, and the ones that said nothing are named as silent.
stopping_conditions:
  - Fewer than two sources in scope — say so and propose nothing; there is no pattern in one document.
  - Nothing new since the last synthesis over this scope — say so rather than restating what is already there.
red_flags:
  - A pattern from one account — that is a signal. Say which second account would confirm it.
  - Flipping a stance to \`committed\` — that is a decision with a decider, not a synthesis output. Propose the decision card and let the PM own it.
  - Inventing a theme so an existing ticket has a parent. Tickets stand on their own; themes come from evidence, never from tidying.
  - Dropping a contradicting source to make a cluster clean — the disagreement IS the finding; name it.
  - Reporting a count that quietly excludes what you could not read. "Six of nine" is a fact; "the interviews show" when three failed is not.
---

## When
The PM points at a body of material and asks what it adds up to. Sometimes the question is pointed
("who wants scheduled exports?"), sometimes it is open ("read these and tell me what's there"). The
material is usually transcripts and sources, sometimes existing insights, sometimes one document you
are asked to read three different ways. This is the step between "we talked to nine people" and
"here is what we believe".

Nothing in the memory has said which of those nine are the same thing said nine ways. That is the
work.

## Read
First **scope it**: which documents are in, and say the list back to the PM before spending anything.
vault_list and search_vault over the tag, customer or theme they named; sources/ and meetings/ for
raw material, insights/ for claims already made. Then the memory you are weighing it against — the
themes that exist there and their current \`stance\`, the decisions that touched them (follow
superseded chains to the live head), and the ticket mirrors where a theme links tracked work.

**Then write \`brief.md\` before you read the corpus.** What we currently believe, the themes in play
and their stances, the live decisions a source might contradict, and what a good answer looks like
for this question. Every child reads it. Without it, a reader handed one transcript in isolation
cannot tell a new fact from a contradiction, which is the most valuable thing this session finds.

**Then \`spawn\` the reading.** One entry with \`over\` set to the corpus gives every document its own
honest pass — that is what makes "six of nine accounts" a fact rather than an impression. Where the
question has more than one lens, add entries: three prompts over the same document read three ways,
in parallel, cannot colour each other the way one agent asked for three things would. Each child
writes \`per-item/{target}.md\` carrying the original path and the verbatim quotes forward.

Read the results back with files_list and files_read. If the first pass leaves clusters too big to
hold, spawn a second wave over the per-item files — children can read everything the first wave
wrote.

## Produce
The clustering, each cluster its own approval card, citing the ORIGINAL sources — never your session
files, which get deleted:
- **A new theme** (propose_note, type theme) where several sources converge on something the memory
  does not hold yet: the durable statement of the thing worth solving, \`evidence\` listing what it
  rests on, and an honest opening \`stance\` — \`exploring\` unless the evidence is already
  overwhelming. Write the theme as the problem, not the feature someone asked for.
- **Insights** (propose_note, type insight) where a single account said something worth keeping on
  its own, quoting them. These are earned here, weighed against everything else, rather than
  manufactured on arrival from one document with nothing to compare it to.
- **Evidence added to an existing theme** (propose_update): extend \`evidence\`, and say in the
  rationale what the addition changes about how strong it now is.
- **A stance re-reading** (propose_update setting \`stance\`) only where the evidence genuinely moved:
  \`exploring\` → \`watching\` when it is real but not now, \`watching\` → \`exploring\` when it woke up,
  anything → \`wont-do\` when the memory shows a deliberate decline (cite the decision). Never
  \`committed\` here — that is a decision, and it gets a decision card with a decider.
- **The dissent** — where sources in the same cluster disagree, or one contradicts a live decision,
  make that its own card rather than averaging it away.
- **What is thin, and what was silent** — which clusters rest on one account, and which documents in
  scope said nothing about the question. Both are findings. An honest "one customer said this
  loudly, six never mentioned it" is worth more than a manufactured pattern.

Only where a theme is ALREADY \`committed\` does tracked work follow: draft_jira_issue for what no
ticket covers yet, citing the theme and the decision that committed to it. Any other stance produces
no ticket — the whole point of \`watching\` and \`wont-do\` is that they are real and deliberately unbuilt.

## Then
Approved cards file the themes and insights and re-stance what moved; the sources stay exactly as
they were. Your session files stay as working material, not memory: if a per-item read was worth
keeping, it was worth proposing as a note. What stayed thin stays visible as thin.
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
- Always link the decision or the shipped ticket that backs the claim.
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
  - Naming a mirrored record (ticket, wikipage — anything with a \`provider\`) for deletion. Its truth
    lives upstream and the next sync restores it; the only honest finding is that nothing connects it.
---

## When
The maintenance sweep noticed something worth a conversation — broken links, notes with no place in
the memory — and the PO opened the ping.

## Know
"No links" is a symptom with different causes, and they do not share an answer:
- **A mirrored record** (ticket/wikipage) is unconnected, not unwanted. Never edit it — re-sync
  overwrites local edits wholesale — and never name it for deletion. The link goes in the hub page.
- **A raw capture** — a dump naming people, customers and themes it never links — belongs in a
  Process-Note pass, not in tidying. Say so and stop; don't half-process it here.
- **A stray page** the workspace owns, citing nothing and cited by nothing, is the only case where
  "this is noise" is a fair thing to say.

## Read
The flagged notes first, then whatever they touch: the notes that cite them, the sources they cite,
and newer meetings/insights that may have superseded their claims (search_vault, vault_read).

## Produce
Small, reviewable repairs — each as its own approval card:
- **Link repairs** — propose_update fixing a broken wikilink to its intended target. If no target
  exists, say so and let the PO choose between creating it and dropping the link.
- **Adoptions** — for an unconnected note, propose_update adding the link to the hub it belongs
  under (the customer or theme page), never to a mirrored record itself. For a stray page
  the workspace owns, saying plainly that it's noise and naming it for deletion is fair — the PO
  deletes, you never do.

## Then
Approved cards mend the memory's fiber. Anything you were unsure about stays a question in the chat,
not a card.
`;

export const COMMITMENT_CHECK_SKILL = `---
type: skill
skill_kind: session
session_type: commitment-check
summary: Commitment check — help the PO deal with one specific todo, as approval cards
tier: outbound
completion_bar: Every card cites the memory it rests on; no due date is moved without a concrete reason.
red_flags:
  - Rescheduling just to clear the overdue flag — a new date needs a real reason, or don't move it.
  - Marking something done on a hunch — only close what the memory actually shows landed.
  - Handling a todo that links a ticket without reading its mirror — a blocked ticket changes what the right answer is.
---

## When
The PO points at one commitment (todo) and asks for help dealing with it — usually because it has
slipped, or they're not sure what to do with it. You are handed that one todo; work only on it.

## Read
The todo itself (its title, due date, owner, and the \`sources\` it cites), the meeting or note where
it was made, and the related customer/theme/decision pages (search_vault, vault_read). When the
todo or its sources link a ticket, read its mirror note (tickets/): its \`state\`, \`state_category\`
and \`remote_updated\` are how delivery actually stands, and they change what sensible handling looks
like. Crucially, check whether it has quietly already happened — search the recent memory for
evidence it landed. And check the calendar: if this commitment involves a person (its \`owner\`, or
someone named in its source meeting), search for an **upcoming meeting** with them — a meeting note
whose \`date\` is today or later that lists them in \`participants\` (calendar-synced meetings link
people as \`people/…\` wikilinks). A live conversation on the horizon changes the best move.

## Produce
The right handling for this one commitment, each as its own approval card. Pick what fits; don't
produce all of them, and never move a date reflexively:
- **A plan** — the default when it's still live and just needs doing: a short \`## Plan\` section on
  the todo (propose_update, body patch) with 2-4 concrete next steps grounded in the memory. A
  linked ticket that is blocked or stalled is plan context, not a reschedule trigger — name it
  ("epic blocked since Tuesday — draft a date-risk note?") and plan around it, often pairing the
  plan with a **Nudge** to whoever was promised.
- **Close it** — only if the memory shows it already happened or no longer matters: propose_update
  setting frontmatter \`status\` to \`done\` (or \`dropped\`) and \`resolved\` to today, citing the evidence.
- **Reschedule** — only if there's a concrete, justified new date (a dependency, a named follow-up):
  propose_update setting frontmatter \`due\`, with the reason in the rationale. If there's no real
  reason, leave the date alone and propose a plan instead; if the reason is a blocked ticket, pair
  the new date with the risk surfaced (the plan or a date-risk note), never a silent bump.
- **Raise it there** — when the person this commitment involves is on the calendar soon: instead of
  a cold nudge, propose a short prep line on that upcoming meeting page (propose_update, body patch)
  — "owe Sara the SCIM timeline (due Fri) — bring the answer" — citing the todo and the meeting. The
  live conversation is the cheaper channel; prefer this over **Nudge** whenever the meeting exists.
- **Nudge** — if it's waiting on someone else and there's no meeting on the horizon: a draft_message
  the PO can send, citing where the commitment was made. Drafted, never sent.

## Then
Approved cards update this commitment in the ledger — the plan lands on the todo, a close flips its
status, a reschedule moves its date. Nothing changes silently, and nothing else in the memory is touched.
`;

export interface DefaultSkill {
  file: string;
  content: string;
}

/**
 * Skill files the pack no longer ships (Sessions v2 Part 5) — deleted from a
 * workspace on seed. A retired file keeps its triggered binding, so leaving one
 * behind means a dropped transcript fires both it and the skill that replaced
 * it. Pre-alpha: local edits to these are not preserved.
 */
export const RETIRED_SKILL_FILES = [
  'skills/after-meeting.md',
  'skills/external-transcript.md',
  'skills/intake.md',
  'skills/interview-synthesis.md',
];

/**
 * The skill a session opens with (Sessions v2 Part 4). Every session is this
 * one; everything else ARRIVES — pulled in by the agent, picked by the PM, or
 * fired by a rule. "Chat" is not a mode you choose, it is what a conversation
 * with the memory is before anything narrows it.
 */
export const BASE_SKILL_NAME = 'chat';

/**
 * The one skill that fires when something lands (Sessions v2 Part 5). It
 * replaced after-meeting / external-transcript / intake / interview-synthesis,
 * which were five skills implementing one routing table: the branch is data —
 * who was in the room, what kind of thing it is — and both fields are already in
 * the capture payload and matched by `bindingMatches`. `intake`'s own red flag
 * used to say "if the PO was in the room, suggest re-filing it as a meeting",
 * which is a session type whose job included telling you it was the wrong
 * session type.
 */
export const ARRIVAL_SKILL_NAME = 'arrival';

export const DEFAULT_SKILLS: DefaultSkill[] = [
  { file: 'skills/arrival.md', content: ARRIVAL_SKILL },
  { file: 'skills/before-meeting.md', content: BEFORE_MEETING_SKILL },
  { file: 'skills/ask.md', content: ASK_SKILL },
  { file: 'skills/chat.md', content: CHAT_SKILL },
  { file: 'skills/process-note.md', content: PROCESS_NOTE_SKILL },
  { file: 'skills/weekly-update.md', content: WEEKLY_UPDATE_SKILL },
  { file: 'skills/synthesis.md', content: SYNTHESIS_SKILL },
  { file: 'skills/librarian.md', content: LIBRARIAN_SKILL },
  { file: 'skills/commitment-check.md', content: COMMITMENT_CHECK_SKILL },
  { file: 'skills/_filing-rules.md', content: FILING_RULES },
  { file: 'skills/voice-exec.md', content: VOICE_EXEC },
  { file: 'skills/voice-cs.md', content: VOICE_CS },
];

/**
 * The built-in skill registry, keyed by skill name (Sessions v2 Part 4). This
 * used to be a session-TYPE map: the key picked which mode a session opened in.
 * A session no longer has a mode — skills arrive into it — so the key is just a
 * name, and this is the fallback the runtime resolves an invocation against
 * when the workspace has no file of its own.
 */
export const DEFAULT_SKILL_BY_NAME: Record<string, string> = {
  arrival: ARRIVAL_SKILL,
  'before-meeting': BEFORE_MEETING_SKILL,
  ask: ASK_SKILL,
  chat: CHAT_SKILL,
  'process-note': PROCESS_NOTE_SKILL,
  'weekly-update': WEEKLY_UPDATE_SKILL,
  synthesis: SYNTHESIS_SKILL,
  librarian: LIBRARIAN_SKILL,
  'commitment-check': COMMITMENT_CHECK_SKILL,
};
