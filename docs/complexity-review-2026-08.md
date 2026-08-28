# Complexity review, August 2026

Second product-complexity pass, 2026-08-24. The first pass (`docs/complexity-tickets.md`,
2026-07-30) covered naming and hidden machinery, and most of its tickets are decided. This pass
covers what shipped since: the card families, the five-tab Skills page, the trust and evidence
model, todos, and connector state.

One finding per section. Each says what exists, why it costs the user, and one way to simplify.
Write your call under **Your comment**. File references point at the code that carries the
finding.

At the end there is a list of things I saw and chose not to flag, with the reason.

Implementation pass 2026-08-24: findings 1-6, 8, 11, 12, 15, 16 and 17 are built, per the
notes under each. Verified together: `pnpm check-types` 11/11, `pnpm test` 922 pass / 0 fail
(10 pre-existing skips), `pnpm lint` 0 errors. Not live-verified in the app, not committed.
Finding 13 still waits for a decision on the rename table.

---

## 1. Three grammars for "the agent needs you"

**What:** A session can show three shapes of output that ask for something. Approval cards have
an accent ring and Approve/Discard. Parked cards (Question, Comments, Spawn, Codebase) say
"Waiting on you" and block the run. The draft panel has no ring and offers Copy and "Use this"
(`DraftTextPanel.tsx:55`). The user must learn three grammars before they can tell "I must act"
from "I may act", and the only cues are the ring and the button row.

**Proposal:** Reduce to two. Anything that needs a yes before the agent spends money or writes
(proposals, Spawn, Codebase) uses the approval-card grammar: ring, Approve, Discard. Anything
that waits for input (Question, Comments) uses the parked grammar: "Waiting on you", Skip. The
draft panel stays plain, that was the point of it. Today Spawn and Codebase are approvals
dressed as a third thing (`SpawnCard.tsx:47`, `CodebaseCard.tsx:60`).

**Your comment:**
sounds good

**Implementation notes:**
Done 2026-08-24. SpawnCard and CodebaseCard carry the approval grammar now: the accent ring,
"Approve & run", and Discard. Behavior (model dropdown, brief fold, decline) is unchanged.
---

## 2. One act of asking, two hidden skills

**What:** Six entry points open a blank question: the sidebar "New session", the Home composer,
the scoped composers, the text-selection "Ask", and ⌘K. All resolve to the hidden `ask` skill.
The seventh, "Ask about this" on a card, resolves to the hidden `chat` skill instead
(`CardItem.tsx:332`). The two skills differ mostly in whether the memory pull happens up front,
and neither appears anywhere the user can see. Many doors to one room is fine. Two rooms that
look like one is not.

**Proposal:** Merge `chat` into `ask`. One built-in default that every blank composer and every
"Ask about this" opens. The user never learns there were two.

**Your comment:**
sure .

**Implementation notes:**
Done 2026-08-24. `chat` is deleted; its body (session files, draft_text and voice guidance)
folded into `ask`, which is now the base skill for every blank session. `chat` stays as an
alias so old receipts and callers resolve. Side find: the "Answered a question" First step
keyed on `skill === 'chat'` and would have gone dead; it now checks the base skill.
---

## 3. Two places to approve the same card

**What:** Cards can be approved in the Inbox and inside the session (`SessionReview`), which has
its own "Approve all (N)", its own error handling, and a link "Review these in the Inbox
instead" (`SessionReview.tsx:114`). The two are separate implementations. The keyboard path in
the Inbox can also approve a card without ever showing its stale banner, which the code has to
patch around (`InboxView.tsx:333`).

**Proposal:** One card component, rendered in both places, with one approve path that always
carries the stale check. The session keeps its review block, but it becomes the same rows the
Inbox shows, not a sibling.

**Your comment:**
sure sounds good.

**Implementation notes:**
Done 2026-08-24. A shared `useApprovals` hook and `CardRows` component render both the Inbox
and the in-session review; SessionReview shrank from 136 to 55 lines and lost its "in the
Inbox instead" link, since the rows are the same rows now. Every approve route (click,
keyboard, batch) surfaces a stale refusal on an open card, and Retry is suppressed where it
would only repeat the refusal.
---

## 4. Four batch buttons, four scope rules

**What:** The Inbox has "Accept all internal (N)" in the header, "Approve all N" per session
group, "Approve all N" per housekeeping block, and "Fix all N" on the librarian section
(`InboxView.tsx:554-867`). Each has its own scope rule, and the spot-audit interstitial can
silently stop a batch halfway (`InboxView.tsx:381`).

**Proposal:** One batch verb with one scope: the group under your cursor. Keep the spot-audit,
but when it stops a batch, say so in the interstitial ("Paused after 5. N left in this group.").

**Your comment:**
yes

**Implementation notes:**
Done 2026-08-24. One button, "Approve all N", scoped to the group it sits on (session group,
librarian run, session review). "Accept all internal", the housekeeping sub-batch, and
"Fix all N" are gone. The spot-audit pause reads "Paused after {n}. {m} left in this group."
A paused batch does not resume itself; the count has already dropped by what landed.
---

## 5. The Memory page teaches 15 nouns

**What:** Day one shows 11 shelves, most at zero, grouped under four labels: Record, Judgment,
People, Delivery (`MemoryView.tsx:35-40`). The four labels appear nowhere else in the app. The
sidebar then shows a different subset of the same types under a different rule (pinned only),
which the UI never states. You decided 2026-08-14 that every shelf shows from day one, so that
part stands.

**Proposal:** Cut the four group labels, or use them somewhere else so they earn their place. A
flat list of 11 typed shelves is fewer words than 11 shelves plus 4 invented categories. And add
one line to the sidebar's Memory header that states the pin rule, so the vanishing sections stop
reading as a bug.

**Your comment:**
sounds good, but the Ticket + WIkipage can be grouped on their own and labeled to make it obvious they are externally synced.

**Implementation notes:**
Done 2026-08-24. The four group labels are gone; shelves render as one flat list, except
ticket + wikipage, which sit in a "Synced" group with the subtitle "Mirrored from your
tracker and wiki. Qale never edits them." The sidebar Memory tooltip now states the pin rule:
"Pinned notes show here. The Memory page holds everything."
---

## 6. The Skills page taxonomy leaks at the edges

**What:** The five tabs are decided (skills rethink, 2026-08-21), so this is about the seams,
not the shape. Three of them: the composer's skill picker only offers the Skills tab, so the
user learns five categories to use one of them (`SkillPicker.tsx:70`). Agents can be started
through links ("Ask the librarian to draft one", "Get the brief") but their own page has no
start button (`SkillAgentPage.tsx:108`). And the create flow interrupts to teach an
implementation rule: "The name is the address Qale runs it by, so it cannot change later"
(`SkillsView.tsx:438`).

**Proposal:** Each non-Skills tab states where its things show up ("Voices appear when a draft
is written", "Moments run on their own; here is where"). Agent pages get a "Run now". The
immutable-name rule moves to the moment someone tries to rename, not the moment they create.

**Your comment:**
Sure

**Implementation notes:**
Done 2026-08-24. The Voices, Moments and House-rules intros now say where each takes effect.
Agent pages have "Run now". The create step says "Name it. Short, lowercase." and the address
shows as a quiet caption on the file's page: "Runs as `<name>`. The title above can change.
This never does."
---

## 7. The house rules file is also a schema reference

**What:** House rules is the one file the product tells the user to edit ("Edit any line here
and the next session works the new way"). Its Filing section names about 24 frontmatter fields
and their allowed values: `processing`, `stance`, `commitment`, `evidence`, `supersedes`, and so
on (`defaults.ts:684-725`). The user's rules and the machine's filing schema share one page.

**Proposal:** Split the file. House rules keeps how Qale writes and speaks, plus the rules the
user added. The filing schema becomes a built-in reference the model always reads, not prose in
the user's editing surface. The model still reads instructions, the user just stops scrolling
past a schema to add a rule.

**Your comment:**
No skip this. 
---

## 8. Ten skills, boundaries written in prose

**What:** The shipped skills overlap in pairs, and the boundary between each pair lives inside
their bodies as cross-references: "that is the spec skill", "the synthesis skill's job", "the
inbound twin of commitment-check" (`defaults.ts:1241`, `:176`, `:1328`). The user only meets
these sentences if they open the files. In the picker, `spec` and `iterate` both end in the same
cards, and `commitment-check` and `incoming-request` are the same move in two directions.

**Proposal:** Two merges to consider: fold `spec` into `iterate` (a spec is an iterate that
starts from conclusions), and fold `incoming-request` into `commitment-check` as one
"handle a promise" skill that detects direction. Where a merge is wrong, put the boundary
sentence in the picker subtitle, where the user actually chooses.

**Your comment:**
Just merge incoming-request and commitment-check

**Implementation notes:**
Done 2026-08-24. One skill, two directions: the title stays "Handle a commitment", the
summary is "Works out what to do about a promise that's slipping, or a request that just came
in", and the body carries both read/produce paths. `incoming-request` resolves as an alias;
on open, an existing vault's copy is renamed to RETIRED-SKILL.md rather than deleted, because
no fingerprint ledger can tell an untouched file from one you rewrote. One consequence to
know: the picker entry "Answer an incoming request" is gone (the merged file sits on
Moments), so the inbound path is paste the message and the session pulls the skill itself.
---

## 9. `processing: stale` has no producer

**What:** The lifecycle promises three states: New, Processed, Stale. Nothing in the app ever
writes `stale`. Every writer sets `new` or `processed`, and every consumer treats `stale` the
same as `new` (`lifecycle.ts:26`, `note-status.ts:58`). The user can select it in the properties
panel on six note types, and it does nothing.

**Proposal:** Cut the state until the freshness spine that would produce it exists. Two states
the app maintains beat three states the user maintains.

**Your comment:**
keep it.
---

## 10. Four different things are called "stale"

**What:** One word, four mechanisms: the note lifecycle state (above), a mirror that is behind
("showing the local copy"), a card whose anchor text moved ("this edit has nowhere to go"), and
an outbound draft whose target changed ("changed since this was drafted"). Each renders
differently, and nothing tells the user these are four things.

**Proposal:** Reserve "stale" for one mechanism or for none. The mirror and outbound copy
already avoid the word, which is the right instinct. A copy sweep can finish the job: the card
banner and the lifecycle label each get their own phrase.

**Your comment:**
Keep it.
---

## 11. A Trust row the user cannot touch

**What:** Notes show a "Trust" row with three tiers (Unverified, Machine-confirmed,
Human-reviewed), derived from a `verified` list only the agent writes. No UI lets the user
verify or un-verify anything; "+ Add property" refuses the key (`PropertiesBlock.tsx:377`).
Separately, the Inbox uses the same word for a different thing: an amber "Unverified" pill on a
card means "no source cited" (`CardItem.tsx:119`).

**Proposal:** Give the row one action: "Mark as checked" writes `human:<you>` with today's date.
And rename the card pill to what it means, "No source cited", so "unverified" has one meaning.

**Your comment:**
yes

**Implementation notes:**
Done 2026-08-24. The Trust row renders on every note, "Unverified" in muted grey, with one
"Mark as checked" action that appends `human:<you>` plus today through a new append-only
use-case (the generic save path refuses `verified` on frozen types, so this is a dedicated
IPC channel). A second click the same day writes nothing. The card pill reads "No source
cited".
---

## 12. Two names for citation: `evidence` and `sources`

**What:** Insights and themes cite with `evidence`; decisions, todos and notes cite with
`sources`. The split exists for a pipeline reason (one channel is resolution-checked, the other
self-heals, `evidence-layering.md:228`), which the user cannot know. Both render as identical
ref chips under two labels.

**Proposal:** One label in the UI ("Sources" on both), whatever the field is called underneath.
The pipeline keeps its two channels; the user reads one word.

**Your comment:**
Yes use Source

**Implementation notes:**
Done 2026-08-24. Both fields render under one "Sources" label, merged into one deduped chip
list when a note carries both. The field names on disk are unchanged.
---

## 13. Todos: the label and the field disagree

**What:** A todo note has a frontmatter field called `owner`. The properties panel shows that
same field with the label "Waiting on" (`properties-schema.ts:142`). So the file says `owner:
Jonas` and the screen says "Waiting on: Jonas": two names for one field, and they frame it in
opposite directions (who does the work vs. who blocks me). The rule "field empty = the todo is
yours" is stated nowhere.

Second, the code has six lane names (Overdue, Due today, Upcoming, Someday, Waiting on others,
Done) but the board shows five different bands (Now, Upcoming, Someday, Waiting on others, Done)
(`todos/index.ts:20`, `TodosView.tsx:43`). The code's names are what the agent and the generated
`index.md` headings use, so the agent can say "Overdue" about a todo the board files under
"Now".

Third, the "Done" band holds both done and dropped todos.

**Proposal:** Exact renames:

| Where | Today | Proposed |
|---|---|---|
| Todo frontmatter field | `owner: Jonas` | `waiting_on: Jonas` (keep reading `owner` from old files) |
| Properties panel label | "Waiting on" | unchanged; now matches the file |
| Properties panel hint | none | "Leave empty when it is yours" |
| Lane labels `Overdue`, `Due today` | two labels | one label, "Now", matching the board |
| Lane label `Done` (the band) | "Done" | "Closed" |
| Per-row resolved text | "done 3 Jul" / "dropped 3 Jul" | unchanged |
| `commitment` values Open / Done / Dropped | unchanged | unchanged |

The six lane tokens can stay in the code for logic (overdue vs. today drives the amber flag).
Only the printed names change, so every surface (board, agent, `index.md`) says the same five
words: Now, Upcoming, Someday, Waiting on others, Closed.

**Your comment:**
yes
---

## 14. One gesture, two meanings on the sidebar

**What:** The X on a note row unpins it (a view preference). The X on a session row marks it
done (a lifecycle write). Same glyph, same hover, same undo strip (`Sidebar.tsx:153`). The user
cannot predict which of the two a click does without knowing the row type.

**Proposal:** The sidebar X always means "leave the rail" for both row types. "Mark done" stays
where lifecycle lives: the session page header and the sessions list. This matches the
"anything in the sidebar is pinned" rule the sidebar already follows for notes.

**Your comment:**
no keep it as is
---

## 15. Machinery rows the user was never meant to read

**What:** Four leaks. The properties panel shows both "State (as in tracker)" and "State
category", though the category exists only to pick the pill colour (`ExternalRef.tsx:30`). The
normalizer's own markers render as ordinary rows: "Needs summary: true", "Broken frontmatter:
&lt;raw yaml&gt;" (`frontmatter.ts:156`). Backlinks grow "Reads" and "Writes" groups that list
session receipts, on every note a session ever touched (`sqlite-index.ts:30`). And Settings
prints the raw MCP `Bearer <token>` block (`SettingsView.tsx:929`).

**Proposal:** Hide the category row. Replace the normalizer markers with one plain sentence and
a fix action. Filter receipt edges out of backlinks or fold them under one "Sessions" group.
Fold the MCP block behind "Show details".

**Your comment:**
yes

**Implementation notes:**
Done 2026-08-24. The State-category row and `needs_summary` are hidden. A broken header shows
one plain sentence instead of a raw-yaml row: "Qale could not read part of this note's
header. The original text stays in the file, exactly as it was written." Session read/write
backlinks fold into one deduped "Sessions" group, listed last. The MCP block sits behind
"Show details", collapsed by default.
---

## 16. Repair copy speaks frontmatter, normal copy speaks plain words

**What:** The permission chips say "Drafts outgoing updates". The error path for the same
concept says `unknown can "draft-outbund". Use one of: draft-outbound, draft-calendar, ...`
(`runnable.ts:252`). The create flow promises "Nobody ever sees a frontmatter key"
(`SkillsView.tsx:348`), which is true until something breaks.

**Proposal:** Error copy leads with the plain label and gives the key second: "This skill asks
for a permission that does not exist. Did you mean 'Drafts outgoing updates'
(`can: [draft-outbound]`)?" The key stays, because the fix is an edit to the file, but it stops
being the whole sentence.

**Your comment:**
yes

**Implementation notes:**
Done 2026-08-24. Errors lead with the chip's words and give the key second, with a
nearest-match suggestion for typos: `This skill asks for a permission that does not exist:
"draft-outbund". Did you mean "Drafts outgoing updates" (can: [draft-outbound])?` The labels
live once, in `CAPABILITY_LABEL` in @qale/sessions, and the chips import them, so the two
vocabularies cannot drift again. The broken-demo skill's prose was updated to match.
---

## 17. Two catalogues of what Qale can do

**What:** Home teaches five starter verbs with 25 seed sentences; the picker teaches the skill
list. The two overlap ("Draft this week's update" beside the weekly-update skill) but a starter
only seeds text, it never picks the skill (`Home.tsx:363`). The user meets two taxonomies of the
same capability on one screen and has to work out that they are unrelated.

**Proposal:** When a starter sentence has an obvious skill, clicking it picks that skill and
seeds the text. The rest keep seeding plain text. One catalogue with two depths, instead of two
catalogues.

**Your comment:**
yes

**Implementation notes:**
Done 2026-08-24. Seven starters now pick their skill and seed the text: the weekly-update
pair, the one-pager (spec), the decision write-up (tell-qale), and the three pattern
questions (synthesis). The rest stay text-only where no single skill is the obvious answer.
A mapped skill whose file is gone degrades to seeding text, silently.
---

## Seen, and not flagged

- **Typed links.** Eight types plus inverses with no behavioural consumer. Ticket 6 of the July
  audit, decided "skip for now". Still true, still skipped. One new fact worth knowing: the
  backlink index also emits five types that are not in the vocabulary at all (`transcript`,
  `problem`, `customer`, `reads`, `writes`); the last two are covered in finding 15.
- **The five-tab Skills shape.** Decided across five rounds in `docs/skills-rethink.md`. Finding
  6 only touches the seams.
- **Memory shelves visible from day one.** Decided 2026-08-14 when progressive reveal was
  deleted. Finding 5 only targets the group labels.
- **Onboarding copy.** Covered by `docs/onboarding-clarity-review.md`, including the open
  card-versus-suggestion rename.
- **Many doors to one room.** Add material has six entry points, Settings has four. Where every
  door opens the same room, this is convention, not complexity. Flagged only where the doors
  open different rooms (finding 2) or carry different meanings (finding 14).
