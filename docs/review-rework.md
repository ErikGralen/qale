# Review rework: two spheres, one row shape

Date: 2026-09-07. Trigger: the H2 steering demo transcript produced nine cards and a
seven-bullet chat summary that retold them. Erik's verdict: the review is a chore, not a glance.

## Decisions

**Two spheres, not three grades.** The workspace has the user's sphere and Qale's memory.

- The user's sphere: Documents (`notes/`), todos, meetings, and anything sent out of the
  workspace (Jira, Confluence, calendar, mail). A write here asks. A delete asks anywhere.
- Qale's memory: decisions, insights, research, about, customers, people, sources, and Qale's
  own skill and agent files. A write here lands as written. Activity keeps the row, the chat
  says one line.

A decision is memory. The spine is append-only and a wrong decision is superseded by the next
one, so a card buys nothing. The `grouped` grade goes away: nothing is graded grouped any more.

The sidebar already draws this line (`surfaceForType` in `lib/nav.ts`). The policy did not:
`inDocuments` in `policy.ts` tested only `notes/`, then rescued todos with an "everywhere" rule
and graded meeting pages as memory. One predicate now says what is the user's, and the sidebar
and the policy read the same one.

**The chat never retells the cards.** After a batch, the wrap is one or two sentences: what
landed on its own, and what was deliberately not proposed. The cards below are the list.

**An answer to ask_user is the PM asking.** A proposal that carries out what they just chose
sets `asked`, so it never comes back as a second question.

**One row shape.** Every card is the same row: the thing that changes, then the change. The
effect line, the source, the rationale and Edit sit behind the chevron. The batch says its
source once, in the heading. There is one Approve all with one count, and the heading says
in a few words why the count is smaller than the list when sends are in it.

**Rows group by target.** Two changes to the same todo, or a todo and a hub edit about the same
customer, sit together under the target's real title. Grouping keys on the target path, never on
kind, shape or source.

**No housekeeping fold.** "Ledgers & links, glance and go" was coined vocabulary and it swallowed
the most interesting changes in the batch (a todo's new due date and a worse customer message).

**Real titles.** A row names the note by its title, never a prettified filename.

## Tickets

- RR-1 Policy: two spheres. `policy.ts` gets one `inUsersSphere(targetPath, noteType)`
  predicate (notes/, todos/, meetings/), everything outside it silent except delete; `grouped`
  removed; Settings copy, `describeWritePolicy`, Hello paragraph, tool descriptions, the arrival
  skill's "Then" section (defaults.ts AND vault-dev move together), SHARED_PREAMBLE "Three things
  always wait" rewritten to the two spheres; tests.
- RR-2 Prompts: ask_user answer counts as `asked`; the closing wrap is one or two sentences and
  never lists the proposals.
- RR-3 Review surface: one row component; target + change; detail behind the chevron; group by
  target; source in the heading; one Approve all; sends keep their full text but the same chrome;
  housekeeping fold and IntentRow deleted; real titles; tests.

## Notes

(Each ticket's builder appends what they did, what they checked and what they left.)

### RR-1 and RR-2

Built 2026-09-07.

**The policy.** `policy.ts` now has one predicate, `isUsersSphere(facts)`: true for a target path
under `notes/`, `todos/` or `meetings/`, or a note type of `note`, `todo` or `meeting`. The folders
are exported as `USERS_SPHERE_DIRS` and the types as `USERS_SPHERE_TYPES`, so the sidebar can read
the same list. `nav.ts` was left alone. The rulings, first match wins: outbound asks, a delete asks,
a skill or agent file lands (with the `asked` reason kept when the PM stated it), what the PM asked
for in the chat lands, the PM's sphere asks, and everything else lands. A decision lands with the
reason "A decision is Qale's record. A wrong one is superseded by the next." An unknown kind still
asks. The style-file branch is gone: the two style files and the voices sit in the memory, so they
land without a rule of their own. `isStyleFile` stays, because `tools.ts` reads it to mark an
Activity row as learned.

**`grouped` is gone.** `WRITE_DISPOSITIONS` is `['silent', 'ask']`. The union member could be
dropped because the RR-3 rewrite of `intent.ts` had already stopped reading it. `DISPOSITION_WORDS`
lost its grouped word.

**Two consequences worth a decision.** Both follow from the rulings as written, and both are a
change from what the code did before:

- A todo the PM asked for in the chat landed for a moment. Reversed the same day: a todo asks
  whoever asked for it, as before (`isTodo` runs before the `asked` rule). `propose_todo` keeps
  the silent path it gained, which nothing reaches today.
- A line added to or taken off "What you want from Qale" now lands, because the house rules are a
  skill file and skill files are memory. Taking a line off used to be a card on purpose; kept as
  it now is, since Activity puts the line back with one press.

**Copy.** `describeWritePolicy()` returns two blocks: "Your documents, to-dos and meetings" (four
rows that ask, one that lands) and "Qale's memory" (five rows that land). The place ids are `yours`
and `memory`. `WritePolicySetting.tsx` keeps its shape and takes the new description line. Hello
screen 5 and PRODUCT.md (the summary, the constraint about a write's cost, and "Nothing lands
unseen") now say the two spheres.

**Tools.** Descriptions that said a decision, a title or a frontmatter change happens "on approval"
now say "when it lands". `propose_skill` no longer claims the file runs only once the PM approves
it. `propose_todo` and the want-list removal both got the silent path they were missing.

**Prompts.** The SHARED_PREAMBLE bullet is now "Two spheres". The deliverable bullet closes with one
or two sentences, never a list, and carries one example. The `asked` bullet says an answer to
ask_user is the PM asking, that a proposal carrying out their choice sets `asked` and cites nothing
for it, and never to ask the same thing twice.

**Skills.** The arrival skill's "## Then" says the meeting page and the todos wait and the
decisions, hub edits and insights land. The same edit went into `packages/sessions/src/defaults.ts`
and `vault-dev/skills/arrival/SKILL.md`. Three more places said something that is no longer true and
moved in both copies: the iterate skill's "## Then", process-note's "## Then", and the librarian
agent's "## Then".

**Tests, as run from the repo root:**

- `pnpm --filter @qale/domain test`: 278 tests, 278 pass, 0 fail.
- `pnpm --filter @qale/application test`: 266 tests, 266 pass, 0 fail.
- `pnpm --filter @qale/agent test`: 335 tests, 335 pass, 0 fail.
- `pnpm --filter @qale/sessions test`: 53 tests, 53 pass, 0 fail.
- `pnpm --filter @qale/desktop test`: 446 tests, 446 pass, 0 fail.
- `pnpm check-types`: 11 packages, 11 successful.

An earlier desktop run failed on `test/review-intents.test.ts` while RR-3 was mid-edit. It passes in
the run above. Nothing is committed.

**Left for the RR-3 builder:** nothing is blocked. `'grouped'` is out of the union, so a comparison
against it in the review code will not type-check. `WritePolicyPlace['place']` is now
`'yours' | 'memory'`. `packages/domain/src/proposals/index.ts` was edited by both of us; the policy
export block and the `groupByTarget` block are both in it.

### RR-3

Built: one row for every card, in `apps/desktop/src/renderer/src/components/review/`.

The row: the glyph of the thing that changes, its real title, the change, and the same three
controls (approve, discard, chevron) in the same place at the same size. A send keeps the ink arrow
beside the glyph and names its act on the approve control ("Post", "Update", "Reply"); a delete says
"Delete". Everything else sits behind the chevron: the effect line, the rationale, "Based on", the
source when the heading does not name it, and Edit.

- **The change is always on screen.** A new to-do says "Rebecca Holm · due 24 Sep · <first line>"; a
  new meeting page says the day, how many sat in it, and its first line. An update draws the
  property changes (`due: 4 Sep → 11 Sep`) and the redline, clamped to about six lines with
  "Show all". A send draws the whole message, scrollable, because a send cannot be taken back.
  The row's diff carries no unchanged context and puts the new text above the text it replaces:
  clamped, a paragraph rewrite showed only the version that was going away.
- **Real titles.** `titles.ts` asks the workspace what a page is called and caches it per file,
  dropped on `vault:changed`. `cardTargetTitle` in the domain decides: the workspace's title for a
  page that exists, the payload's own for a page being created, the de-slugged filename last.
- **Group by target.** `intent.ts` is now `groupByTarget`/`targetKey` on the file path, or the
  external id for a send. Two changes to one to-do draw under one name, each keeping its own three
  controls. A group header is not a cursor stop; every row is.
- **One count.** The heading reads "8 changes and 2 sends from <source>", the button "Approve all 8".
  The source is named once, as an openable chip with the page's real title.

Deleted: `HousekeepingItem`, `IntentRow.tsx`, `HOUSEKEEPING_RANK` and the housekeeping fold,
`sourceHint` and the per-row "from <source>" line, the `WhyToggle`/`WhyPanel` fold (the rationale is
the detail now), `cardDisposition`/`cardFacts`/`intentKey`/`intentSentence`/`groupIntents` and the
kind-shape-source key behind them, the group-level "Approve all N" / "Discard all", `CardRows`'
unused `compact-updates` and `gap` variants, and `cardHeadline`'s `verb`/`note`/`authored`/`kind`
fields. Nothing reads the `grouped` disposition any more.

`groupCause` stays: a librarian sweep over `notes/`, `todos/` and `meetings/` can still put a pile of
updates citing one decision in front of the PM, and those still ask.

Two places where this brief and `docs/proposal-card-copy.md` disagreed, and this brief won:

- The row leads with the target's title, not the composed verb-first headline. The headline is still
  composed, still the aria label for the row, and still what the detail says.
- The approve control on a send says the act in one word rather than "Send". That keeps
  proposal-card-copy's rule that only a message is sent and a page is updated in place.

Rendered and looked at: the real batch from the H2 steering demo (the "Qale Demo Dev" profile, nine
stored pending cards, copied to a scratch userData with the secrets stripped, `QALE_OPEN=__session:`,
self-exiting one-shot). One tenth card was added to the scratch database by hand (a due-date change
on `todos/reply-marcus-swap-eta.md`) so a group of two would draw. Four rounds: the first showed the
diffs opening on removed text only, which is what led to the no-context, result-first row diff; the
second showed the raw ISO dates in the property line, now "4 Sep → 11 Sep"; the third showed the
batch source repeated as a "Based on" chip behind every chevron, now dropped when the heading names
it. Screenshots: `review-top.png` (heading, expanded row, the group) and `review-bottom.png` (the two
sends) in this session's scratch directory.

Checks: `pnpm test` 1509 tests, 1497 pass, 0 fail (12 skipped in `@qale/vault`); `@qale/domain` 278
pass, `@qale/desktop` 446 pass. `pnpm check-types` clean. `pnpm --filter @qale/desktop lint` 0
errors, 33 warnings, all the pre-existing `react-refresh/only-export-components` kind. Nothing is
committed.

A short replaced span now reads in place, struck and washed, right before the new one:
"Payroll export (Fortnox first) Shift swaps — Q3". The "was…" toggle stays for a long rewrite, where
printing both halves would double the line. Re-rendered the same batch and looked at the Confluence
row and the Marcus group: `review-inline-swap.png` and `review-inline-swap-top.png`.

**Left:** the "Based on" chips still name a note by its de-slugged filename (`EvidenceChip` →
`titleForRef`); giving them real titles means a lookup per chip and was out of scope here. The delete
row, the stale "Fix this" banner and the send-refused "Approve anyway" path were read and carried
over, but this batch had none of them, so they are not screenshot-verified.
