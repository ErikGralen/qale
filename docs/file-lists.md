# One file list, everywhere

Status: BUILT 2026-09-06. FL-1..FL-5 and CL-1..CL-7 are all in. 423 desktop
tests pass, every package typechecks, lint is clean. Screenshot-verified in a
running window on the demo workspace: the Memory tree (shelves, expand in
place, the empty-shelf line), the Jira mirror list (Name / State / Updated,
board tones, newest first), the decisions shelf (Name / Date, facets, the
supersedes second line), and Documents unchanged. NOT verified: the mirror row
menu (Open in Jira, Copy link), drag and drop, the context menus, and the
keyboard on the new trees. Not committed.

Delete this doc when the work ships.

Documents got a Finder-style list on 2026-09-05 (docs/documents-folders.md).
It reads better than anything else in the app. This doc says where else it
goes, where it does not, and what to clean up on the way.

Decisions below are mine, taken on the reading of the working tree on
2026-09-06, and marked so. Change any of them and the ticket under it changes.

## The Documents page is four things, not one

They come apart, and the split decides everything else.

1. **The row.** One line, 28px, a glyph, the title, a right-hand rail.
   `app/DocumentRow.tsx`.
2. **The pick model.** The row IS the selection: click picks, ⌘click adds,
   ⇧click takes a range, double-click or ↵ opens. `lib/selection.ts` already
   holds this model and the checkbox model side by side.
3. **The sort rail.** Columns you click to sort by, click again to turn around,
   and the pick is remembered. `SortRail` inside `DocumentsView.tsx`.
4. **The folder machinery.** Expand in place, enter a level, breadcrumbs, New
   folder, rename, delete, Move to, drag and drop, Undo. `lib/documents.ts`,
   `lib/dnd.ts`, `FolderListRow`, `NewFolderRow`, `folder:*` IPC.

Parts 1 and 3 are about reading a list, and they travel. Part 4 is about owning
a structure, and Documents is the only screen where the structure is the
user's, so it stays. Part 2 travels only as far as the job does: see the next
section.

## Where each part goes

| Surface               | Row    | Pick model             | Sort rail                  | Folders                 |
| --------------------- | ------ | ---------------------- | -------------------------- | ----------------------- |
| Documents             | shared | Finder (row picks)     | Name, Modified             | yes                     |
| Memory page (shelves) | shared | none                   | no                         | shelves expand in place |
| A Memory shelf        | shared | checkbox (click opens) | Name, Date                 | no                      |
| Jira / Confluence     | shared | checkbox (click opens) | Name, State, Updated       | no                      |
| Context page (`#tag`) | shared | checkbox (click opens) | no, sections are the order | no                      |
| Activity              | no     | no                     | no                         | no                      |

**Decision (Erik, 2026-09-06): the Finder pick model DOES travel, and the
checkbox is gone.** My earlier call was that it should not, on the grounds that
a shelf is for reading and a mirror is a backlog. Erik's answer: one click
model, everywhere. A single click selects, a double click or ↵ opens, ⌘click
adds one, ⇧click takes a range. There is no checkbox anywhere.

It is the better call. Two selection models meant two vocabularies for one job,
and the page you were standing on decided which one applied. The file-manager
model is the one people already know. `lib/selection.ts` now documents one
model, and the code only the checkbox needed (a shift-range that only adds, the
`alwaysSelectAll` opt-in) is deleted rather than left dead.

**Decision (mine): one line everywhere, and the title truncates.** `NoteList`
today wraps a title to two lines on purpose ("half a sentence is not something
you can recognise at a glance"). That reverses here. A dense one-line row is
the whole point of the ask, the full title is the row's tooltip and its
accessible name, and doubling the rows in view is worth more on a browse page
than the tail of a long title. The one exception is the supersedes chain: see
CL-1.

---

## A. Memory

`MemoryView.tsx` draws six rows, each two lines: the shelf name with a count,
and a sentence about what the shelf holds. A click leaves the page for
`FolderView`. It is already a folder list. It just does not look or behave like
one.

### FL-1. Memory is the same tree Documents is

**Change:** One `role="tree"` list at full pane width. Each shelf is a folder
row: chevron, type glyph, name, count in the right rail. The chevron opens the
shelf in place and lists its notes as file rows one level indented, newest
first, capped at nothing (the shelf page is one click away either way).
Clicking the row still enters the shelf through `openFolder`, so navigation and
crumbs do not change. Arrow keys, ↵, and Right/Left work as on Documents, from
the same `moveRowFocus`.

Expansion rides the view body the way Documents' does: `{ kind: 'memory';
expanded?: string[] }`, set through the renamed `setExpanded`.

**Decision (Erik, 2026-09-06): the shelf description is cut.** `TYPE_DESC` is
deleted outright, all six entries. I had kept it under an empty shelf as a map
of what the workspace can hold; the shelf name and count carry the row on their
own, and the empty state inside the shelf (`EMPTY_TEACH` in `FolderView`)
already teaches the mechanism.

No `+` anywhere on this page, unchanged.

### FL-2. A shelf browse page uses the file row

**Change:** `FolderView`'s list mode renders `NoteList` over the shared row.
Full pane width, not the centred `max-w-2xl` column: a column rail has to reach
the edge or the columns float. The second column is the note's reference date
(`formatRefDate`), never the file mtime, because a decision's own date is what
a person means by "when". A lifecycle word (`superseded`, `cancelled`) sits
inline before it.

No folder machinery here: no New folder, no Move to, no drag, no levels.
`decisions/`, `insights/`, `research/`, `customers/`, `people/` and `sources/`
are all flat on disk, and Qale files them. A folder affordance would promise
ownership the app does not honour.

The row's context menu keeps only what applies: Open in new tab, Rename,
Delete.

---

## B. Jira and Confluence

The strongest fit and the cheapest build. A mirror folder is flat
(`tickets/jira`, `wikipages/confluence`), read-only, and every row carries two
facts a person sorts by. That is a backlog, and a backlog is a table.

### FL-3. The mirror list is a file list

**Change:** Three columns: the title, State, and Updated. Updated reads
`remoteUpdated ?? mtime`, the same value `TicketBoard` prints. State wears the
board's own tones, so a row and a card colour one fact the same way. Sorting by
State orders by `stateCategory` in flight order (open, in progress, blocked,
done), never alphabetically.

The board stays the folder's default and stays as it is. This only stops the
list from being the poor relation.

### FL-4. A mirror row's context menu

**Change:** Open in new tab, Open in Jira (or Confluence), Copy link. Nothing
that writes. Qale never authors a mirror, so Rename, Move to and Delete must
not appear. The provider's name comes from `providerLabelOf`, the same one the
header uses.

Selection stays on mirrors, because pinning a batch of tickets is a real job
(docs/memory-placement.md).

---

## C. Context pages

### FL-5. `#tag` pages use the same row

**Change:** The row swaps for the shared one. The sections, the spine order and
the eight-row cap all stay: the order on this page is an argument, and a sort
rail would flatten it. So no sort rail and no columns past the date.

It is the smallest ticket. It is here so the app does not keep a third row
style alive.

---

## D. Activity: not this

`ActivityView` rows are not files. They are events with a sentence, a time, a
link back and a per-row undo. Some carry no path at all. There is nothing to
select, nothing to sort by, and nothing to open into. A file list there would
be a costume over a different thing.

**Decision (mine): leave it alone.** Not even the row height, which would only
make the receipt look like a list of things to act on.

---

## Cleanup

CL-1 and CL-2 are what make every FL ticket small. They come first.

### CL-1. One row component

Two rows exist with two selection models, two keyboard maps and two layouts:
`NoteRow` inside `app/NoteList.tsx` and `app/DocumentRow.tsx`.

**Change:** `components/FileRow.tsx`, one row with

- `pick: 'checkbox' | 'row'` — which selection model it obeys.
- `meta` — what goes in the right-hand rail, laid out by the caller against the
  exported width classes.
- `actions?` — the context menu. Absent on a page that organises nothing.
- `depth` — the indent, 0 at the level the page stands in.
- `draggable?` — the drag source. Documents only.
- `subline?` — a second line, drawn only when there is one.

`components/FileList.tsx` owns the `ul`, the role and the arrow keys.
`app/NoteList.tsx` stays as the thin wrapper its call sites already import, so
`FolderView` and `ContextView` barely change. `app/DocumentRow.tsx` becomes a
call site rather than a component.

**Decision (mine) on the supersedes chain:** it survives, as `subline`, and
only on the rows that have one. Only decisions carry a chain, they are never on
Documents, and the decision spine being readable in-list is something this
codebase built on purpose. Every Documents row stays exactly one line.

### CL-2. Split `lib/documents.ts` into a generic layer and a `notes/` layer

`isDocument`, `documentFolder`, `documentFolders` and `docCount` all hardcode
`notes/` through `DOCUMENTS_DIR`. The tree walk (`visibleRows`, `childFolders`,
`docsAt`, `sortFolders`, `folderMtimes`, `toggleExpanded`) and the sort helpers
are already generic and already tested.

**Change:** `lib/files.ts` holds the generic layer, taking the directory as an
argument where it needs one. `lib/documents.ts` keeps the `notes/`-bound names
its six import sites already use, as thin bindings over it, plus the drag
payload helpers. Two files, one responsibility each, and no rename churn at the
call sites. `test/documents.test.ts` stays green; `test/files.test.ts` covers
the generic layer.

Not a rename for its own sake: FL-1 needs `documentFolder('decisions/x.md')` to
answer `decisions`, which today it does only by accident.

### CL-3. Split `DocumentsView.tsx` (841 lines)

Out of it, behaviour unchanged:

- `SortRail` → `components/SortRail.tsx`, taking column definitions. FL-2 and
  FL-3 both need it.
- `FolderListRow` and `NewFolderRow` → `app/FolderListRow.tsx`. FL-1 needs the
  first one.
- `moveDocs` and `deleteDoc` with their undo offers → `lib/move-documents.ts`.

What is left is the page: the level, the rows, the header, the composer.

### CL-4. `FolderView.tsx` is four pages in one (474 lines)

It holds the instant filter, the lifecycle facets, month grouping, two alt
layouts, the aimed drop target, the New button and the composer. The filter and
the facets are good and stay.

**Decision (mine): the sort rail replaces the group-by toggle.** A page with a
"date / flat" toggle _and_ a clickable Modified column teaches two vocabularies
for one job. Month grouping only ever earned its keep on meetings, and meetings
open on the week view.

### CL-5. One scheme for a remembered list setting

`qale.documents.sort` is one global key; `qale.folder-view.<dir>` is per
directory. Make it `qale.list.<surface>.sort` with one parse-and-store helper in
`lib/list-sort.ts`. Every read must survive returning the default: a packaged
`file://` build keeps no localStorage.

### CL-6. `type FolderView` shadows `function FolderView`

Same file, line 33 and line 144. The type becomes `FolderLayout`.

### CL-7. One section heading

`ContextView.tsx:87` and `FolderView.tsx:445` carry the same markup and the same
`pl-8` comment about the checkbox gutter. One `components/ListSection.tsx`.
CL-1 moves that gutter, and with two copies one of them gets missed.

---

## Not doing

- Folders inside a Memory shelf. Qale files those notes, so the app must not
  offer to let the user own the structure.
- Drag and drop anywhere but Documents. Dropping a decision on a customer means
  nothing.
- More than three columns. Mirrors get the third and that is the ceiling.
- A density setting. One list, one size.

## Order

CL-1, CL-2, CL-3, CL-5 and CL-7 first: they are the shared parts. Then FL-3 and
FL-4 (mirrors), FL-1 (Memory), FL-2 with CL-4 and CL-6 (shelf pages), FL-5
(context pages) in parallel, because after the shared parts land each of those
owns its own file.

---

## What was built that this plan did not say

- **`lib/folder-sort.ts`.** The State and Updated comparators came out of
  `FolderView` so the flight order could be tested. It has eight tests; before
  the split, none of FL-3's ordering was covered.
- **`NoteRefDTO.remoteUrl`.** FL-4 needs the door back to Jira on a list row,
  and the URL only lived in the full note's frontmatter. Added to the DTO and
  filled in `main/dto.ts` from `url`, so a synced meeting carries it too.
- **`FOLDER_TITLE_GUTTER`.** A folder row's title starts 0.75rem further right
  than a file row's, because a chevron is wider than a checkbox. Anything drawn
  under a folder row lines up with this and not with `TITLE_GUTTER`.
- **`refSlug` has one home.** `NoteList` and `FolderView` both parse the
  supersedes wikilink, so it moved to `lib/frontmatter.ts`. `TodosView` keeps
  its own: that one is deliberately looser (a bare path, a `.md` tail, a `|`),
  and its comment now says so.

## Bugs found and fixed on the way

- `docCount` built its prefix as `` `${DOCUMENTS_DIR}${key}/` ``, assuming the
  directory ends in a slash. Generalised, it returned 0 for every `tickets`
  call. `lib/files.ts` normalises, with a test.
- `moveDocs` read the undo strip's title from `paths[0]` but showed it whenever
  exactly one file moved. Move three, have only the second succeed, and the
  strip named the first. It now carries each moved document's original path.
- `NoteRow` set `title={n.summary || undefined}`, so a note with no summary had
  no tooltip while its title was clamped. A long title had nowhere to be read in
  full.
- `storedView` in `FolderView` read `localStorage` bare. A packaged `file://`
  build throws there, which is the hazard `lib/list-sort.ts` documents.
- `FolderView` decided "is this a mirror?" from the loaded tree, and the bare
  `tickets` folder answered wrong. Rows Qale never authors would have offered
  Rename and Delete. It reads off the path now, so it is settled on the first
  render.

## Deliberately not done

- **Copy link says nothing when it works.** The toast is the app's one "that
  failed" channel, red border and warning glyph, so a success line there reads
  as an alarm. The clipboard is its own receipt.
- **The lone "Not yet" lifecycle chip on the Jira page.** It predates this work
  and the facet code is byte-identical, so it was left alone. Worth a look: a
  one-chip facet row filters nothing.
- **`DocumentsView` is 529 lines, not the under-400 the plan guessed.** The
  parts that moved out were 282 lines. Getting further means moving the folder
  writes (`newFolder`, `renameFolder`, `deleteFolder`) out too, which no ticket
  named a home for.

---

## Round 2, 2026-09-06: one click model

Erik's call after seeing round 1: Jira, Confluence and Memory still opened on a
single click, and the mirrors still carried checkboxes. Both are gone.

- **`FileRow` lost its `pick` prop.** The checkbox model is deleted, not made
  optional. Every row: click picks, ⌘click adds, ⇧click takes a range, double
  click or ↵ opens, ⌘⇧click and middle-click open a tab.
- **`lib/selection.ts` collapsed to one model.** `toggled()` no longer takes an
  ordering, an anchor or a `range` flag; `selectionKeyDown` no longer takes
  `alwaysSelectAll`, because ⌘A is always the list's now. Two tests that only
  covered the checkbox paths went with them, and the header comment no longer
  describes two models.
- **The gutters merged.** With no checkbox, a file row's title and a folder
  row's title both start at 4.25rem. `TITLE_GUTTER` is `pl-17` and
  `FOLDER_TITLE_GUTTER` is deleted.
- **`FileList` is always `role="tree"`** and requires a `label`. Every row emits
  `role="treeitem"`, and a treeitem outside a tree is not a thing. `NoteList`
  takes a `label` and passes it on; `ContextView` names each section's list.
- **Memory rows are selectable.** `MemoryView` has a selection over the notes of
  expanded shelves, a picked-shelf wash, a selection bar, and arrow keys that
  carry the selection the way Documents' do.
- **`TYPE_DESC` deleted**, per the decision above.
- **The selection bar says what it holds.** It read "1 note selected" on a Jira
  page; a mirror folder now hands it the word it already uses for its count, so
  it says "1 ticket selected". A shelf keeps "note", because a per-type word
  would need a plural table for "person".

Extended beyond what was asked: the `#tag` context pages got the same model.
Leaving one surface clicking differently is the inconsistency the change is
meant to remove. Reversible on its own.

Also on Memory, and worth a second opinion: a click now selects, so the page
grew a selection bar. On memory types it offers Delete alone (`isPinnable`
hides Pin). If that is unwanted, the pick can stay a highlight with no bar.

### Still open

- **`SelectionBar` offers Delete on a mirror row.** It did before this work too
  (`FolderView` rendered the bar at HEAD), so it is not new, but deleting a
  local copy of a Jira ticket is a strange thing to offer on a folder Qale never
  writes.
- A repeated Electron screenshot run in one session hangs on the second launch,
  which made verification slower than it should be. Worth a look if the
  screenshot harness is going to carry more weight.

---

## Round 3, 2026-09-06: the selection moves into the header

Erik's call after using round 2: ticking a row grew a strip under the header and
pushed the whole list down, then pulled it back up on clear. The thing you were
aiming at moved twice per click.

- **The strip is gone. The header holds the selection.** `SelectionBar` now
  renders into `PageHeader`'s right cluster: a hairline rule, "3 selected",
  "Select all 45", a second rule, then the actions. Nothing below the header
  moves, ever.
- **The view's own actions step aside while a batch is held.** Documents swaps
  "New folder" and "New document" for the bar; a folder page swaps its "New
  decision". `PageHeader` takes a `selecting` flag and wears a light ink wash
  for as long as the batch lasts.
- **The count label lost its noun.** It says "3 selected", not "3 notes
  selected": the ticked rows are in plain sight, and the header has a location
  to hold as well. `noun` still feeds the tooltips, the confirm and the toast.
- **Clear is a glyph.** Esc does the same thing, and the row is tight.
- **Memory's header count is gone.** "Memory · 45" summed six shelves that each
  print their own count two lines below it.

Delete still confirms in place, in the same header row: "Delete 4 notes?" with
Delete and Cancel. It fits at 900px, the app's minimum width, because the
location crumbs truncate first.
