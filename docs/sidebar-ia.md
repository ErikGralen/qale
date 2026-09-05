# Sidebar IA: Documents are yours, Memory is Qale's

Date: 2026-09-05. Status: spec, being built.

> Superseded in part 2026-09-05 by `docs/memory-placement-plan.md`. Two
> statements below no longer hold: SB-1's "a pinned memory page renders under
> the Memory row" (no memory page pins any more, only tickets and wiki pages
> pin) and "Memory holds what Qale knows" as a rail place (Memory moved to the
> footer; it is no longer a place on the rail).

## The problem

The rail says Documents and Memory are two places, but the pins ignore the
split. A note you create appears under Memory in a "notes" section. Meetings
pin under Memory while Calendar is their home. The page crumb says "Notes",
FolderView says "Memory › notes", the rail says "Documents". Three names for
one place. And the pin set grows on every save, so the rail fills up with
things nobody chose to keep there.

`nav.ts` already states the intended map (`surfaceForType`: note→documents,
meeting→calendar, shelves→memory). Nothing reads it. This spec makes the rail
follow it.

## The idea

Documents hold what you write. Memory holds what Qale knows. A row under a
place in the rail is a pinned item of that place, nothing else.

## Tickets

### SB-1: Split the pins by home

- A pinned document (type `note`, path under `notes/`) renders under the
  Documents row. A pinned memory page (source, decision, insight, theme,
  customer, person, ticket, wikipage) renders under the Memory row.
- Each place shows one flat list, most recent first. No type sections, no
  section headers. Document rows show the title. Memory rows carry the type
  icon so a person and a theme read apart.
- Delete `PinnedTree`, `TypeSection`, `PIN_SECTION_ORDER`, `NEVER_PINNED` and
  `railOrder` from Sidebar.tsx. `lib/pins.ts` owns the two selectors.
- Meetings leave the rail. Calendar and Home already cover them. `meeting`
  joins the unpinnable types. An old pinned meeting stays in the favorites set
  but stops rendering, which is harmless.
- The X, the Undo strip, and the blue new-pin dot carry over unchanged.
- `understanding/` files have `type: note` but are not documents. The document
  selector filters by path (`isDocument`), not by type.

### SB-2: Pin on creation and arrival, not on touch

- Keep: pin when you create a page by hand (⌘N, the "+" menus, the New
  document button) and the auto-pin of unprocessed sources
  (`qualifiesForRail` is unchanged: material that arrived and was not gone
  through must stay visible).
- Cut: the `pinForWork` calls in `saveNote`, `markChecked`, `restoreVersion`,
  `saveFrontmatter` and `acceptProposal`. Editing a page does not pin it. You
  have it open. Approving a proposal does not pin its file. Activity and the
  receipt already say what happened.

### SB-3: One word: document

- The user-facing label for type `note` is "Document". The place is
  "Documents". ⌘N is "New document". A page's type badge reads "Document".
- The sweep covers display strings only: `noteTypeLabel`, `NEW_NOTE_PURPOSE`,
  rail copy, menus, tooltips, empty states, proposal card copy. Code
  identifiers, the `note` type value, the `notes/` folder and IPC names do
  not change.
- "Notes" stays only where it means writing during a meeting ("Take notes",
  meeting notes). That is an act, not the type.

### SB-4: One location line per page

- The crumb on a page follows `surfaceForType`. A document reads
  "Documents › \<folder\>" and the crumb opens DocumentsView at that folder. A
  meeting reads "Calendar" and opens Calendar. Everything else reads
  "Memory › \<shelf label\>" and opens the shelf's FolderView.
- `openFolder` routes `notes` and `notes/*` to DocumentsView, so no path
  shows the old Memory-owned notes browser.
- FolderView's crumb uses the shelf label from the type, not the raw dir.

### SB-5: Tests

- `lib/pins.ts` selectors: split by type and path, `understanding/` excluded,
  folder indexes excluded, order by recency.
- `isPinnable` rejects `meeting`.
- The trimmed `pinForWork` call sites: a save does not pin, a create does.
- Crumb computation per type.

## Decisions taken here

- **Meetings are not pinnable.** One home per thing. Calendar shows upcoming,
  Home shows today. A meeting row under Memory was the loudest inconsistency
  in the old rail.
- **"Document" wins over "note".** The place shipped as Documents, so the item
  follows. Two words for one thing read as two things.
- **Flat lists, not sections.** With conservative pinning the lists are short.
  Section headers earned their keep when every edit pinned; now they are
  chrome.
- **Sources still auto-pin.** It is the one principled auto-pin: you put
  material in and have not gone through it. Everything else in the rail is
  either a place or your own choice.
