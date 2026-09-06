# Memory types: records, and the notes Qale keeps for itself

Date: 2026-09-06. Status: built the same day, MT-1 to MT-8 (MT-9 skipped:
spec takes a tag now, and nothing has used it yet). Not committed, not
live-verified. Decisions marked "(Erik)" were taken in the session that wrote
this. Decisions marked "(mine)" are the writer's reading. Delete this doc when
the work has been checked live.

Three things came out different from the tickets below, and the code is right:
the per-shelf sentence lives in `FolderView.tsx` `EMPTY_TEACH`, not a
`TYPE_DESC` map; the migration's Activity row has no put-back, because the
existing undo restores one note from one commit and this commit moves a
folder; and the `understanding/` special cases were in `slug.ts`,
`index-files.ts` and `summaries.ts`, not the renderer lib files. One follow-up:
the "Told it about your product" first step fires on a grouped update, and the
first product page from the interview lands silently, so it does not fire on
the first write. That was already true before this change.

## Where we are

Memory holds six shelves: source, decision, insight, theme, customer, person,
plus Synced for tickets and wiki pages (`MEMORY_SHELVES` and `MIRROR_SHELVES`
in `lib/nav.ts`). Every shelf is one folder on disk, and the type of a note is
its folder (`NOTE_TYPE_META` in `domain/notes/frontmatter.ts`).

Five of the six are records. Each one is a fact with provenance:

- a source is bytes you received, kept as they came
- a decision is a call you made, append-only
- an insight is one claim with the quote it came from
- a customer and a person are entities that turn up in meetings

Theme is not a record. It is an argument: a cluster of insights, a stance, and
a paragraph on why they belong together. Synthesis writes themes, the spec skill
reads one as its input, and arrival, process-note and commitment-check say
"extend the theme hub" when new signal fits. The `#tag` Context page already
gathers everything about a problem, and tags are Qale-owned and written without
a card. So the gathering half of a theme is covered without it. The argument
half is worth keeping, but not as its own type.

Two more things sit outside the shelves:

- `understanding/` holds product, technical and organization notes with
  `type: note`. Qale keeps them, you correct them. They have no shelf and no row.
  `crumbs.ts`, `pins.ts` and `documents.ts` each carry a special case to keep
  them out of Documents.
- The agent has nowhere to put a page it wants for itself. `propose_note`
  allows a "generic note", but the only folder for one is `notes/`, which is
  Documents, and the write policy grades a page there as `ask` because it is a
  page you did not put in your own folder. A competitor analysis, a market scan,
  a scan of a codebase: today each one either costs a card or does not get
  written. The demo's `notes/competitors.md` is a page of exactly this kind,
  and it sits in your folder.

These are one gap. A theme is a note the agent wanted to write and had nowhere
else to put.

## The idea

Memory pages come in two kinds, and the folder says which.

1. **Records.** Sources, decisions, insights, customers, people. A fact, with
   provenance, in the shape its type fixes. Unchanged by this plan.
2. **Research.** What Qale worked out: the case for a problem (what a theme
   was), a competitor scan, the product picture (what `understanding/` was), a
   technical overview. Free-form body, every page cites its sources, the
   librarian keeps it fresh, you correct anything wrong.

One folder holds all research. One type, one shelf, one row in the rail's
Memory page. It reads as a folder of files because it is one.

**Decision (Erik): the agent creates no folders.** Every write goes to one of
the known top-level folders, one level deep. The research folder is where the
agent's "other" pages go, and it is flat. Folders are the PM's tool, on
Documents, and stay there.

**Decision (Erik): the "other" pages get one folder of their own.** Not
`notes/`, not spread over the record shelves.

**Decision (mine): the folder is `research/`, the type is `research`, the
shelf reads "Research".** Alternatives considered: `workings/` (nobody says
it), `analysis/` (too narrow for the product picture), `findings/` (sounds like
insights). Change the name and every ticket below changes with it.

**Decision (mine): the write policy needs no change.** A new page outside
`notes/` is already `silent`, an update that rewrites one is already grouped.
That is the point of putting research in its own folder. MT-5 only adds the
test that says so.

## What a research page is

Frontmatter: the shared base (`type`, `title`, `summary`, `tags`, `processing`)
plus `sources` (wikilinks, may be empty for a page drafted from the interview)
and an optional `customer`. Body free. `TYPE_RULES`: body editable, all fields
mutable.

No `stance`. **Decision (mine): stance becomes a line in the body, not a
field.** Three of the four stances were never read by code, only by the spec
skill's prose. `wont-do` is a decision by nature, so a wont-do theme migrates
as a research page whose first line says so and links the decision if one
exists. If you want stance back as a field for sorting, say so and MT-1 adds
`stance: z.enum(...).optional()` on the research schema alone.

The page cites, it does not quote-stack. The evidence-layering rule
(`docs/evidence-layering.md`: themes argue, insights quote) carries over
unchanged: a research page states the case in one voice and links the insights
that hold the quotes.

## Tickets

### MT-1. The `research` type

**Change:** Add `research` to `NOTE_TYPES`, `NOTE_TYPE_META` (`dir:
'research'`, `layer: 'authored'`), `TYPE_RULES` (body editable, `'all'`), and a
`zResearch` schema as described above. `frontmatterReference` prints it.
`PLURAL_FOR_DIR` in `proposals/intent.ts` gets `research: 'research pages'`.
`typeForDir('research')` resolves.

### MT-2. Retire `theme`

**Change:** Remove `theme` from `NOTE_TYPES`, `NOTE_TYPE_META`, `TYPE_RULES`,
`zTheme`, `THEME_STANCES` and the lifecycle table, `PLURAL_FOR_DIR`,
`MemoryView`'s `TYPE_DESC` and its folder-name map, the `first-steps.ts`
segment, and the `vault_list` tool description (it names `stance`). Grep for
`'theme'` and `themes/` across `packages/` and `apps/` and take each one. Card copy in `domain/proposals/card-copy.ts` loses the theme
noun. The properties schema (`state/properties-schema.ts`) loses `stance`.

**Decision (mine):** delete, do not deprecate. An old workspace is handled by
MT-8, and a type that exists "for compatibility" is one more shelf to explain.

### MT-3. Fold `understanding/` into `research/`

**Change:** `product.md`, `technical.md`, `organization.md` become research
pages. `what-goes-here.md` folds into the research folder's `index.md`
description and the house-rules entry (MT-6), and the file goes. `tell-qale`
reads and writes `research/product.md` and its siblings. The three special
cases in `crumbs.ts`, `pins.ts` and `documents.ts` are deleted, because a
research page is not `type: note` and needs no exception.

### MT-4. The Research shelf

**Change:** `MEMORY_SHELVES` becomes `source, decision, insight, research,
customer, person`. `TYPE_DESC.research`: "What Qale worked out: the case for a
problem, a competitor scan, the product picture. Correct anything wrong."
`surfaceForType` follows on its own. The file-lists plan (`docs/file-lists.md`
FL-1, FL-2) lists shelves from that array, so the tree and the shelf page pick
it up. The second column on the shelf page is the reference date, as FL-2 says.

**Decision (mine):** shelf order puts research after insight and before
customer, so the page reads sources, then what was decided, then what was
claimed, then what was worked out, then who.

### MT-5. Write policy: prove it is already right

**Change:** Tests in `domain/proposals/policy.test.ts`: a new `research` page
is `silent`; an update to one is `grouped`; a new page whose path is
`research/a/b.md` is rejected before the policy sees it (MT-6). No policy code
changes.

### MT-6. Tools and prompts: no folders, one place for research

**Change, tools:** `propose_note` and `propose_update` reject a path that is
not `<dirForType(type)>/<slug>.md`: exactly one folder segment, the folder the
type owns. The rejection says which folder the type lives in. This is the
"agent creates no folders" decision, enforced where the write happens, not in
prose. `file_source` and `refile_source` already write to `sources/` only;
add the same one-segment check.

**Change, `propose_note` description:** name `research` as the type for "a
page you want to keep for yourself: an analysis, a scan, a picture of the
product", and say it lands without a card.

**Change, prompts:** `SHARED_PREAMBLE` describes the layers as raw sources,
derived notes, records, research, and the PM's documents. The theme sentence
goes. House-rules (`skills/house-rules/SKILL.md`) replaces the `themes/` entry
with `research/` and states the rule: one folder, flat, Qale's own, every page
cites.

**Change, skills:**

- `synthesis`: Produce lists insights, and "a research page where several
  sources converge on one problem" in place of "a new theme".
- `spec`: takes a research page, or a `#tag`, as its input. The "which theme"
  question becomes "which page or tag".
- `arrival`, `process-note`, `commitment-check`: "extend the theme hub" becomes
  "extend the research page for that problem, if one exists; otherwise tag the
  insight and leave it". A page is not created for one signal.

**Decision (mine):** synthesis is the only skill that creates a research page
on its own. The others extend one. This keeps the folder from filling with
one-paragraph pages.

### MT-7. Demo vault

**Change:** `vault-dev/themes/*` move to `vault-dev/research/` as research
pages with the stance line in the body. `vault-dev/understanding/*` move the
same way. `vault-dev/notes/competitors.md` moves to `research/competitors.md`,
because it is Qale's page, not the PM's. Root `index.md` and each folder
`index.md` follow. `scripts/refresh-demo.ts` and the seed copy the new tree.
Wikilinks across the vault are rewritten (`[[themes/x]]` → `[[research/x]]`).

### MT-8. Existing workspaces

**Change:** On open, if `themes/` or `understanding/` exists, the app moves
each file into `research/`, rewrites the frontmatter (`type: research`, stance
to a body line, `evidence` to `sources`), rewrites wikilinks across the
workspace, writes one git commit, and lists one Activity row ("Moved 4 themes
and 3 understanding pages into Research") with the usual put-back.

**Decision (mine):** a one-time move, not a dual mapping. `typeForDir('themes')`
returning `research` forever would leave two folders for one shelf, which is
the thing the shelf exists to avoid.

### MT-9. The `#tag` Context page (optional)

**Change:** The Context page lists research pages first, before insights and
sources, because the research page is the argument and the rest is its
evidence. One sort change in the Context view.

**Decision (mine):** do this only if MT-6's "spec takes a tag" turns out to be
used. Otherwise skip.

## What this does not do

- No new entity types. A competitor is a research page, not a shelf.
- No folders for the agent, anywhere, ever. See the decision above.
- No change to Documents, folders, or the file-lists work in flight.
- No "questions" type. Open questions live in sessions and `offered` rows.
