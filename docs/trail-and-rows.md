# The work trail and the write rows

Date: 2026-09-11. Status: BUILT, not live-verified, not committed.

Trigger: Erik, on a real transcript. "It's just very messy with lots of text." The same seven
writes were told three times in one turn: in the prose, in the folded trail as "Created … /
Updated …" steps, and in the rows under the trail. Expanded, a trail step showed the tool
result written for the model ("Say what you did in one short line and carry on") plus the
hidden JSON marker.

## What we want

Four things at once, in this order when they pull against each other: every action is visible,
every write is traceable and undoable, the design stays minimal, and what the agent added is
easy to see.

## Decisions

**A write is told once, as a row.** A step whose result has its own surface on screen does not
draw in the trail. A landed write has a row. A waiting write has a card at the foot. A draft has
a panel. A failed write has none of those, so it stays in the trail, marked as failed.

**The trail's collapsed line is the summary, not a noun.** "Reasoning" is gone, and so are
"sources" and "actions". The line says what the trail did in plain words: "Read 2 notes ·
searched twice · 12s", "Read the transcript and the calendar page", "Thought for 8s". Live it
still narrates the current step. A trail with nothing left to show draws nothing.

**The trail never shows tool output.** A read step's name is a chip that opens the note. A search
shows its query. A failed step shows its error in one line. The receipt text is for the model.

**Rows fold from four.** One to three writes draw as rows. From four, they collapse to one line
with the rows behind it, and the diff and Undo one more chevron away.

**The folded line is words, not names** (Erik, 2026-09-11). It named every page at first, and the
names made it longer than the rows it was standing in for. It now says each tier in a few words:
"3 new todos · Updated memory". A name that matters is one chevron away, on its own row, where it
opens. The one exception is a page that went: nothing else on screen says so, so the line names
it, in red.

**The block has one fixed order, and it is what the PM acts on** (Erik, 2026-09-11). To-dos and
meeting pages Qale made, then to-dos and meeting pages that moved, then the PM's own documents,
then everything Qale filed for itself, then anything that went. The folded line and the expanded
rows both follow it.

**A row is a mark and a chip.** A todo, an insight, a new page and a removed page carry no change
phrase: the title is the change. An updated page carries at most one short body phrase. Property
phrases like "processing now processed" and "last told now 2026-09-10" are gone.

**The receipt tells the model not to retell.** The tool result for a landed write says: the app
shows this under your message with its diff and an undo; do not say what you did; say what it
means. The preamble already said so, and the receipt contradicted it.

Not done: merging the reads trail and the write rows into one strip. They answer different
questions (where did this come from, versus what did you change), and a write with Undo should
not hide behind "read 2 notes".

## Rules as built

The trail (`lib/trail.ts`, 2026-09-11):

- A step draws in the trail unless it already has a surface: a result carrying the landed marker
  (it has a row), or a `propose_*` or `draft_*` call (it has a card or a panel). A failed step of
  any kind always draws.
- The collapsed line is built from the steps that draw, and never counts a failure: reads first,
  then the systems it searched, then the searches of the memory, then anything else, then the
  clock. One or two notes are named by title, three or more are counted ("Read 3 notes"). Jira
  and Confluence reads count as tickets and pages. A trail with nothing but thinking reads
  "Thought for 8s"; one with nothing but failures reads "Worked for 3s". The failed count keeps
  its own red words after the line.
- A trail that has settled with no step and no thinking left draws nothing at all.
- Expanded, the trail is the thinking and the steps in order. A step shows its verb, its target,
  and nothing else: a note is a chip that opens it, a search shows its query, a failure shows its
  one-line error. `[[wikilinks]]` in a label read as the page title.

The rows (`lib/receipt-block.ts`, `LandedRows.tsx`):

- One to three writes draw as rows. From four they fold, collapsed by default, behind one line.
  The whole line is the button that opens it, with the same classes as the work trail above it
  and the chevron at the end. Its own words are its label. Expanded, the rows draw as before.
- **Memory is the one tier that always folds** (Erik, 2026-09-11, amended same day). The fold-from-
  four count is taken over everything except memory. However few memory writes a turn made, one or
  ten, they draw as their own "Updated memory" line with its own chevron, never as separate rows
  with page names. A turn that wrote only to memory is that one line and nothing else. This
  reinstates the "Memory is one line" rule from `docs/receipt-redesign.md` RC-1, which the same-day
  fold-from-four rework had, without meaning to, made conditional on the total count.
- Both the line and the rows read in five tiers, in this order (`orderLanded`, `tierForRow`):

  1. **New to-dos and new meeting pages.** "3 new todos", "new meeting page", "2 new meeting
     pages".
  2. **To-dos and meeting pages that moved.** "1 todo done", "2 todos changed", "meeting page
     updated", "2 meeting pages updated". "done" and "updated" are Activity's own words, so the
     chat and the ledger never say one write two ways.
  3. **Documents** (`notes/`): "new document", "2 new documents", "document updated", "3 documents
     updated".
  4. **Memory**: always "updated memory", whatever it touched. No names and no type counts. What
     Qale filed for itself is its own record, and the rows say which pages.
  5. **Removals**, last, named, in the destructive colour: "removed Old runbook". Up to three
     names, then "and 2 more". Never counted, never folded away.

  A to-do always carries its number; a meeting page or a document carries one only when there is
  more than one. Clauses join with " · " and the first word is capitalised, because the line
  otherwise opens mid-sentence ("Updated memory"). Two writes to one page count as one page. An
  approved send keeps its green card and does not draw here, but it holds a place between
  documents and memory for the one case that reaches this block.

- The mark over the line follows the first tier: a plus when the turn made a to-do or a meeting
  page, a pencil otherwise.
- The line is recomputed from the rows that still stand, so an undo takes itself out of it. If
  every row is undone the line reads "Undone".
- A row is a mark and a chip. Only a changed page says anything after the chip, and only about
  the body: "3 places changed", "one line under Entra", "2 lines added". A to-do in any state, a
  new page, an insight and a removal say nothing. No property phrase reaches a row any more.
  `changeLine()` in the domain now returns the body phrase for an update and an empty string for
  everything else. Activity writes its own sentence and did not change.

The receipt (`packages/agent/src/tools.ts`):

- Every landed write reports back with the same tail: "It is done and nobody has to click: the
  chat shows it as a row with its diff and an undo. Don't say what you did; when you're done, say
  what it means." The four receipt sites share one constant. The per-site sentences that said
  where the write landed are gone; the landed marker carries that.
- The preamble now says the notes are listed in the chat above the reply, which is where they
  draw.

## Code

- `apps/desktop/src/renderer/src/app/SessionView.tsx`: `ActivityBlock`, `ToolStep`.
- `apps/desktop/src/renderer/src/lib/trail.ts`: which steps the trail draws, and what its
  collapsed line says. Tested in `apps/desktop/test/trail.test.ts`.
- `apps/desktop/src/renderer/src/components/review/LandedRows.tsx`: rows and the fold.
- `apps/desktop/src/renderer/src/lib/receipt-block.ts`: fold threshold and summary line.
- `packages/domain/src/proposals/card-copy.ts`: `changeLine()`.
- `packages/agent/src/tools.ts`: `applied()` receipt tail. `packages/agent/src/prompts.ts`:
  the preamble rule.
