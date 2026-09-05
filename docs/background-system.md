# The system in the background, after the Documents and Memory split

Date: 2026-09-05. Status: decided and built the same day (ticket 5 left open). Notes under each ticket.

Documents hold what you write. Memory holds what Qale knows. The rail now says so
(docs/sidebar-ia.md, docs/memory-placement.md). The machinery under the rail was built before
that sentence existed, and most of it still treats the two places as one workspace. This doc
asks what should change: one librarian or two, what may land without asking in each place,
who owns tags and frontmatter, and which sweeps stay on the clock.

## Where we are

One 5-minute tick (`runMaintenance` in `handlers.ts`) does six things in order:

| Step | What it does | Where it writes | Asks? |
|---|---|---|---|
| Sync | Pulls Jira, Confluence, calendar | `tickets/`, `wiki/`, `meetings/` | No (mirrors) |
| Scan | Graph facts: broken links, unlinked notes, drift pairs, frontmatter mismatch, untagged | Nothing, builds a worklist | |
| Librarian session | Reads the worklist, proposes repairs; at most one run per 30 minutes | Through `propose_*`, graded by the policy | Per the policy |
| Summary pass | Haiku writes one `summary` line per document and meeting, and a purpose per folder (IM-6, IM-7) | Straight to the file, including `notes/` | No |
| Orientation maps | Regenerates every `index.md` | Reserved files | No |
| Normalize | Fills derivable frontmatter (`type` from folder, `captured` from mtime) | Straight to the file, including `notes/` | No |

One write policy (`packages/domain/src/proposals/policy.ts`) grades every proposal. It already
knows about the split: an unasked write into `notes/` asks, whatever it is. Outside `notes/`,
a new page or an append lands silently, a rewrite or a decision goes in a grouped card,
delete, todo and outbound always ask.

The librarian agent file (`agents/librarian/AGENT.md`) does not know about the split. It
says "you keep the memory tidy" and then treats every note the same.

## What the split exposed

Three places where the machinery and the sentence disagree.

**An unlinked document is a finding.** The orphan scan excludes machinery and meetings and
nothing else, so a scratch document you wrote and linked nowhere reaches the librarian as
"Unlinked note: nothing links it and it links nothing". The librarian then reads it and
offers to process it, link it from a hub, or delete it. For a Memory page that is right: a
theme nobody wired in is a filing error. For a Document it is noise. A document is allowed to
stand alone. That is what a folder of your own is for.

**Tags are the agent's, and every tag costs you a card.** E-15 took tags out of your hands:
read-only chips under the expanded details, no add, no remove. Yet the untagged sweep sends
recently changed notes, documents included, to the librarian, which proposes 1 or 2 tags with
`propose_update`. A frontmatter change is never append-only, so the policy grades it: `ask`
for a document, `grouped` for a Memory page. You are asked to approve a label you cannot
edit. Either tags are yours (then you can edit them) or they are Qale's (then it does not
ask). Today they are neither.

**Two writers sit outside the policy.** The summary pass and the normalize pass write into
`notes/` without a card. Both are justified in code comments as "machinery, not authorship:
a retrieval label, reversible through history, never a claim". I agree with the argument.
The problem is where it lives. Rule 6 of the policy says nothing writes into Documents
unless you asked, and the two exceptions are stated three packages away, in comments. One
of those comments is already stale: `normalize.ts` still says a summary "goes through the
ordinary approval card", which IM-6 stopped being true.

---

## 1. One librarian or two?

**Options**

- A. Two agents: a Documents librarian and a Memory librarian, each with its own scan,
  ledger, settle window and interval.
- B. One librarian, two mandates written in its own file. Under Memory it is the steward:
  it files, links, repoints, tags, and proposes deletes. Under Documents it is a guest: it
  reads, fixes a link that points out of a document at a page that was renamed, and touches
  nothing else. The scan stops reporting unlinked documents at all.
- C. Nothing changes.

**My read.** B. The graph crosses the boundary all the time: a document cites a decision, a
meeting links a customer. A broken link from a document into Memory belongs to whichever
librarian you pick, and with two you pick wrong half the time or run both. What differs
between the two places is not the work, it is the permission, and the policy already carries
the permission. Per the house rule, fix what the model reads: two paragraphs in
`LIBRARIAN_AGENT` saying what each place is and what it may do there. The one mechanical
change is `notes/` leaving the orphan scan, because "nothing links it" is not a fact about a
document.

**Decision:**
ok go B

**Notes:** Built 2026-09-05. `LIBRARIAN_AGENT` in `packages/sessions/src/defaults.ts` gained a
`## Two places` section between the intro and `## When`: Memory is what Qale keeps and the librarian is
its steward (file, link from a hub, repoint a replaced decision, propose a delete); Documents is
`notes/`, the librarian is a guest there, the one repair it may propose is a link out of a document at
a page that was renamed, and a document is allowed to stand alone. `## A note with no tags` is gone
(ticket 3). `vault-dev/agents/librarian/AGENT.md` moved with it; `defaults-sync.test.ts` keeps them
in step. `.vault-dev/` is stale until the next `pnpm refresh-demo`.

`getMaintenanceReport` in `packages/application/src/use-cases/vault.ts` skips a document in the
orphan half, through `USER_DOCUMENTS_DIR` from the policy (not `isDocument` from `index-files.ts`,
which would make an import cycle). The dangling-link half is unchanged. Two tests added, and the old
orphan fixtures moved from `notes/` to `insights/` because they are no longer findings.
---

## 2. What may land without asking, per place?

The policy is close to right. This ticket is about making the two places its first axis,
and about the two writers that bypass it.

**Options**

- A. Keep the rules as they are. Move the two exceptions into the policy as one stated
  rule: a derived label (`summary`, `summary_at`, `purpose_of`, and the normalizer's
  fields) is machinery and lands silently everywhere, Documents included. The summary and
  normalize passes stay as they are, and the policy file is where the exception is written.
- B. As A, and reorder the policy so place comes first. Documents: labels land, what you
  asked for in chat lands, nothing else. Memory: new page and append land, rewrite and
  decision group, delete and todo and outbound ask. Same rulings as today, read in the order
  a person would explain them.
- C. Per-place toggles in Settings: "Ask me before Qale changes anything in Memory".

**My read.** B, and no C. The rulings do not change, so B is a rewrite of one function and
its comment. The gain is that the function reads the way the product will be explained
(ticket 6). C is the config surface PRODUCT.md refuses: the product is opinionated, revert
already exists for anything that landed on its own, and a toggle is a decision the PM has to
keep true.

**Decision:**
B

**Notes:** Built 2026-09-05 in `packages/domain/src/proposals/policy.ts`. `writePolicy` is now three
named functions read in order: `rulingEverywhere` (outbound, delete, todo, rule file, asked),
then `rulingInDocuments` (nothing else lands) or `rulingInMemory` (new page and append silent,
rewrite and decision grouped, unknown kind asks). No ruling changed for any input; the order the
doc asked for was already the precedence, so the existing tests pass unchanged and six were
added. The machinery exception is stated in a doc comment over `DERIVED_LABEL_FIELDS` (`summary`,
`summary_at`, `summary_of`, `purpose_of`, `type`, `captured`) and `QALE_OWNED_FIELDS` (`tags`),
with `isMachineryField()`. It points at `properties-schema.ts` as the statement of record and
says the domain never imports the renderer. `normalize.ts` and `summaries.ts` lost their stale
"approval card" wording and point at the policy and the schema.

Also exported: `describeWritePolicy()` for ticket 6, two places of twelve rows each, the first
ten built by calling `writePolicy` with representative facts so the screen cannot drift.
---

## 3. Tags: Qale's, or yours?

**Options**

- A. Qale's. A tag is a retrieval label, the same kind of thing as a summary. It lands
  silently everywhere, with an Activity row and revert. Tagging leaves the librarian and
  joins the summary pass: the same Haiku call that writes the one-line summary picks 1 or 2
  tags from the tags in use. The `untagged` finding kind, its window and its worklist line
  go. One fewer card per touched note, one fewer thing on the librarian's list.
- B. Yours. Put the editing back (E-15 reversed) and keep the card.
- C. Split: silent in Memory, a card in Documents.

**My read.** A. E-15 already decided the direction; this finishes it. C keeps the odd case
(a card for a label you cannot edit) exactly where it bites most, on your own documents.
The one thing to keep from the librarian's prose: not every note needs a tag, and a tag
nothing else carries finds nothing. That moves into the summary prompt.

**Decision:**
A

**Notes:** Built 2026-09-05. Tagging left the librarian: the `untagged` finding kind, its window, cap,
vocabulary paragraph and worklist line are deleted from `use-cases/librarian.ts`, and the IM-14
tests with them. The summary pass (`use-cases/summaries.ts`, prompt in
`packages/agent/src/summaries.ts`) now writes two labels in one call. A note is a candidate when
its summary is a placeholder or stale, or when it carries no tags; a `summary_of` marker that
matches the body means the pass already read it, so a "no tags" answer is never asked again. Tag
types: meeting, decision, insight, customer, theme, todo, note, source; never mirrors, reserved
files, understanding or voice files, sessions or skills. The answer is one summary line plus an
optional `tags: a, b` line, at most two tags, taken from the tags in use (most used first, capped
at 24); a new tag must be one plain word; an unreadable answer writes nothing. No empty `tags:` is
ever written. The prompt carries the two rules from the old librarian prose: not every note needs
a tag, and a tag nothing else carries finds nothing.

The commit message is now `maintenance: labels`, and the tick's failure report is named
`maintenance`. One meaning shift: `summary_of` used to mean "the body this summary came from"
and now means "the body the pass last read", so a hand-written summary gains a marker the first
time the pass tags the note and is rewritten when the body later changes. The pass opens more
files per tick (every untagged note of a tagged type), but a tagged note of a non-summarised type
is judged from the index and never opened. No live model call was made; the parser fails quiet.

The Activity half came in a second pass. `runSummaryPass` records one `labelled` Activity row per
note after the commit (`recordLabels`, through `recordActivityRow` shared with `proposals.ts`),
with `undo: 'restore'`, the pass's commit hash, no proposal and no session. `ActivityRecord` and
`ActivityDTO` carry `proposalId` and `sessionId` as nullable; the store keeps its `NOT NULL`
columns and round-trips an empty string. The row reads "I added a summary and 2 tags to Renewals:
pricing, checkout." or "I tagged Renewal risk: pricing.", and its reason is the policy's sentence
(`DERIVED_LABEL_REASON`, `TAG_REASON`, now exported and shared with the Settings section). Revert is
tested end to end on a real repo. Folder purposes get no row: they land in reserved `index.md`
files the Activity view cannot name or open. A marker-only write gets no row either.
---

## 4. Frontmatter: say once who owns each field

Today the ownership of a field is spread over four places: `agentOwned` on `TAGS` in
`properties-schema.ts`, `isTodo` and `isRuleFile` in the policy, `NORMALIZER_MARKERS` in the
domain, and `SUMMARY_OF_FIELD` and friends in `summaries.ts`.

Three tiers cover every field we have:

- **Derived.** Machinery writes it, nobody reads it as a claim: `summary`, `summary_at`,
  `purpose_of`, `type` when the folder states it, `captured` from the file date.
- **Qale's.** The agent writes it, you read it: `tags`, `processing`, `verified`.
- **Yours.** You write it, or Qale proposes and you approve: `title`, `due`, `commitment`,
  `status`, `participants`, `supersedes`.

**Options**

- A. State the tiers in `properties-schema.ts` as one field on `FieldSpec` (`owner:
  'derived' | 'agent' | 'user'`), replacing `agentOwned`. The editor reads it for
  read-only. The policy and the passes keep their own lists for now, with a comment
  pointing at the schema as the statement of record.
- B. As A, and make the policy read the schema: a frontmatter-only update whose fields are
  all derived or agent-owned lands silently, anything touching a user field asks or groups.
- C. Leave it spread out.

**My read.** A now. B is the right end state but it means the domain policy importing a
renderer schema, or moving the schema down a package, and that is a bigger move than the
value today. Do B when a third machinery writer appears.

**Decision:**
A

**Notes:** Built 2026-09-05 in `apps/desktop/src/renderer/src/state/properties-schema.ts`.
`agentOwned` is replaced by `owner: 'derived' | 'agent' | 'user'` on `FieldSpec` (absent reads
as user), every spec carries one, and a header comment names the file as the statement of record
with the policy and the two passes pointing back. `OFF_ROW_OWNERS` records the fields the panel
draws no row for (`type`, `summary_at`, `summary_of`, `purpose_of`, `needs_summary`,
`broken_frontmatter`, `verified`, `title`). Derived: `summary` (still editable, drawn by
`SummaryEditor` outside the spec loop), `captured`, `updated`, `skill`, `state`, `assignee`,
`remote_updated`, `version`. Agent: `tags`, `processing`, `verified`. Everything else is the
PM's. On screen the only changes are two rows that lost their cursor: `updated` (Last synced) on
a source, and `processing` (Gone through). `processing` got it back through a `keepsCursor` flag
on the spec, because that select is the PM's only way to say they read a source themselves and
want it out of the unread count; the tier still says Qale drives it.

Two loose ends the build found. The policy's `QALE_OWNED_FIELDS` holds only `tags` while the
schema calls `processing` and `verified` agent-owned too; not a conflict, since no pass writes
those two on its own. The normalizer fills a missing `title` from the slug, but the schema keeps
`title` as the PM's, so a repaired title is the one derived write the schema does not name.
---

## 5. Which sweeps stay on the clock?

| Pass | Today | Proposed |
|---|---|---|
| Sync | Every tick | Unchanged |
| Broken links | Librarian, both places | Librarian, both places (a document's link out is still a link) |
| Unlinked notes | Librarian, both places | Memory only |
| Drift pairs | Librarian, Memory by nature | Unchanged |
| Frontmatter mismatch | Librarian | Unchanged |
| Untagged | Librarian, card per note | Summary pass, silent (ticket 3) |
| Summaries and folder purposes | Summary pass, silent | Unchanged |
| Orientation maps | Every tick | Unchanged |
| Normalize | Every tick | Unchanged |
| Consolidation | Not built (docs/mvp-strategy.md M5) | The one Memory-side gap worth building |

The clock is not the problem; the settle window, the 30-minute interval and the ledger
already keep it calm. What Memory lacks is not a second librarian but the pass the
librarian has never done: reading what recent sessions added and proposing what the memory
should now say differently (two insights that are one, a customer page that stopped being
true, a decision chain nobody repointed). That is M5, triggered at session end and never on
the timer, and its Decision is still blank.

**Decision:**


**Notes:** Nothing decided here, and nothing built directly. Two rows of the table changed as a result
of tickets 1 and 3: unlinked notes are Memory only, and untagged notes moved from the librarian
to the summary pass. The consolidation pass (M5) stays undecided in docs/mvp-strategy.md.
---

## 6. Say it on screen

Nothing tells the PM which writes Qale makes on its own. Activity is the receipt after the
fact. The policy already produces a one-sentence reason for every ruling ("A new page takes
nothing away.", "Documents is your folder, so you say what goes in it."), so the copy exists.

**Options**

- A. One readable section in Settings, "What Qale does on its own", two short lists (in
  your documents, in its memory) built from the policy's reasons. No toggles. The
  onboarding "How Qale works" screen gets the same two sentences.
- B. Nothing new. Activity and the revert are the explanation.

**My read.** A. Clearer permissions means the PM can predict the behaviour, not that they
can configure it. It is one screen of text, and it forces us to keep the policy small enough
to fit on it.

**Decision:**
Yes

**Notes:** Built 2026-09-05. `apps/desktop/src/renderer/src/components/WritePolicySetting.tsx` is one
`Setting` titled "What Qale does on its own" at the end of the agent tab in Settings, two
columns (In your documents, In its memory), rows grouped by disposition in the order silent,
grouped, ask, with the policy's own reason in muted text. Disposition words, one term each:
"Lands, listed in Activity", "Asks, one proposal per intent", "Asks every time". Nothing
interactive. `lib/write-policy-copy.ts` does the grouping from `describeWritePolicy()` and holds
no copy of the policy's strings; five tests hold it to the policy. ⌘K finds the section through
the agent tab's keywords.

The Hello screen's second paragraph now says it: Qale never writes in your own documents unless
you ask; in its own memory a new page or an added paragraph lands on its own, listed in Activity
with one press to put it back; anything that rewrites your text, records a decision, makes or
closes a promise, deletes, or leaves for Jira, Confluence or a calendar asks first. The third
paragraph's "an AI that asks first never surprises you" became "what the AI does on its own can
always be put back". Not seen live.
---

## Small things found on the way

All three done 2026-09-05.

- `normalize.ts` said a summary goes "through the ordinary approval card". It now points at the
  policy's machinery exception and the schema.
- The tick's failure report is named `maintenance`, and the label pass commits as
  `maintenance: labels` (was `librarian: summaries`).
- The librarian's untagged worklist line went with ticket 3.

Found while building, outside the tickets: the demo copy of the weekly-update skill had drifted
from `defaults.ts` by one word ("Inbox" against "session"), which failed the defaults-sync test;
the mirror now matches. `AgentLifeSigns.tsx` still read `agent.name` after `AgentDTO` renamed it
to `id`, a type error a stale turbo cache had hidden; fixed. `.vault-dev/` needs
`pnpm refresh-demo` before the next demo.

## Not doing

- No second agent, ledger or tick for Documents.
- No per-place toggles, no permission matrix.
- No user-editable tags.
- No new tools. Every change above is prose in the agent file, a reorder of one policy
  function, one pass absorbing a finding kind, one schema field, and one settings section.

## Order

1 and 3 together: both cut what the librarian sees, and both are mostly prose. Then 2 and 4,
which are the same afternoon. 6 once 2 has settled, because the screen is generated from the
policy. 5's consolidation pass is its own workstream under M5.
