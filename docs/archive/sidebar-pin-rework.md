# Sidebar pin rework — the rail is a persistent set of pins

Status: **built 2026-07-25** (typecheck + lint + tests clean; visual pass pending).

## The problem

"Pinned" today means two different things depending on where a note sits:

- A flat **Pinned** section at the top holds notes the PO explicitly pinned
  (`favorites`). Pinning from a note view sends it *here*, detached from its type.
- Per-type **shortlists** (Meetings, Notes, Tickets, Decisions, Problems) are a
  *derived, ranked, capped view* the system recomputes from note metadata on every
  render. Each row carries its own **Pin** button (promote into the flat section)
  and **Clear (X)**.

Two problems fall out of this. First, the per-row **Pin** button implies the rows
aren't already "kept" — but they are the sidebar. Second, because the shortlist is
recomputed every render, items **churn in and out on their own** as metadata
changes (a meeting gets reviewed and silently vanishes).

## The model

**Anything in the sidebar is, by definition, pinned.** There is no separate Pinned
section, and no per-row Pin button. The sidebar is a **persistent set of pinned
notes, grouped under their type.** The only per-row action is **X** (unpin →
leaves the sidebar).

Two ways a note gets pinned:

1. **The PO pins it** — the note-view toggle (`NoteView.tsx:143`). Pin an unpinned
   Ticket → it appears in the sidebar under **Tickets**.
2. **The system auto-pins it** — when a note becomes genuinely live (a meeting goes
   upcoming, a ticket goes active), the system adds it to the set.

Both land in the same set and look identical. Crucially: **the system only ever
adds. It never silently removes** (decided 2026-07-25). Once something is on the
rail — auto-pinned or hand-pinned — it stays until the PO X's it. A meeting that's
been reviewed doesn't disappear on its own; it sits there until the PO clears it.

### State — two persistent sets, per workspace

Reuses the existing localStorage keys, with new meaning:

- **`favorites`** (`pm.favorites.v1:<vault>`) → the **pinned set**: every path on the
  rail, auto- or hand-pinned. This *is* the sidebar's content.
- **`dismissed`** (`pm.dismissed.v1:<vault>`) → the **unpinned set**: paths the PO
  has X'd. Its only job now is to stop the auto-pinner from re-adding something the
  PO deliberately removed. (Drops the old `mtime` re-surface-on-change logic — under
  a persistent rail there's nothing to re-surface; existing entries migrate to
  "unpinned".)

### Two operations, exact opposites

| Act | Effect |
|-----|--------|
| **Pin** (note-view toggle) | `favorites.add(path)`; `dismissed.delete(path)`. |
| **Unpin / X** (the one per-row rail action) | `favorites.delete(path)`; `dismissed.add(path)`. |

### The auto-pinner

A client-side effect (no main/IPC changes — pin state stays in the renderer as
today). Whenever the tree loads or changes, walk it and **add** any note that newly
*qualifies* to `favorites`, **but only if it's in neither `favorites` nor
`dismissed`** — i.e. the system has never pinned it and the PO has never unpinned
it. `favorites ∪ dismissed` is the "already decided, hands off" set, so each note
is auto-pinned **at most once, ever**. After that it's the PO's to keep or clear.

**What qualifies** (proposed — conservative, time-sensitive work only; tunable):

| Type | Auto-pins when | Rationale |
|------|----------------|-----------|
| meeting | inside the day horizon, or happened-and-awaiting-review | inherently transient, demands attention |
| ticket | live (status ≠ done) | current delivery truth; bounded by the sprint |
| problem | open (stance ≠ wont-do) | what's live |
| source | unprocessed (status new/stale) | needs triage |
| decision | — (manual only) | lookup material; would accumulate as clutter |
| note | — (manual only) | the ⌘N scratch pad; pin deliberately |
| off-rail (customer, release, insight, person…) | — (manual only) | reference shelves; manual pin spawns a temp category |

This mirrors the current shortlist's "live" definitions, minus the recency-filler
(which only existed to pad a capped list to a glance — a persistent rail doesn't
need it). On an existing vault the first pass pins whatever's currently live, which
is roughly what the sidebar shows today — continuity, except now it sticks.

### The meeting day horizon (refined 2026-07-28)

"Upcoming" was too generous: because the rail never auto-removes, a meeting three
weeks out would pin the moment it appeared and then sit there for three weeks. What
the rail reaches for has to be worth *keeping*, so the meeting clause is now a
horizon over the day, computed across the whole meeting set
(`meetingRailHorizon`, `lib/note-status.ts`):

- **Everything dated today** — including meetings that have already happened, which
  are exactly the ones with follow-up left in them.
- **From 15:00 local onward, tomorrow's opening cluster** — its earliest *timed*
  meeting plus anything starting within 2h of it, plus any all-day entry. By
  mid-afternoon "what's next" is tomorrow morning, not the rest of today; the
  cluster keeps that to the next block rather than a second full day.
- **Cancelled events never auto-pin** — they need nothing from the PO.
- **A day with no meetings at all opens the next day that has them**, whatever the
  hour. The narrow horizon exists to stop the rail hoarding the calendar, not to
  leave Meetings blank on a quiet Tuesday. Self-limiting: every quiet day reaches
  for the same cluster, and the auto-pinner adds each path only once.

The awaiting-review clause is unchanged and deliberately unbounded by age: a dropped
transcript of an older meeting still earns a pin, because it still needs triage.

Liveness here is a fact about the clock, not the vault, so the auto-pinner also runs
on a 5-minute tick (`app-state.tsx`) — an app left open overnight still picks up the
new day's meetings without a file change to trigger it.

### Categories

- The **five defaults** — Meetings, Notes, Tickets, Decisions, Problems
  (`RAIL_TYPES`) — always render, even when empty. Fixed structure; the obvious
  home for a pin.
- **Temporary categories** — pin an off-rail type and a section for it appears,
  showing only its pins; it vanishes when its last pin is X'd.
- No caps, no "N more" truncation of the pinned list — the section shows *every*
  pin of its type. (The type header still opens the full folder to browse
  everything, pinned or not.)

## What changes in code

1. **`app-state.tsx`**
   - `toggleFavorite` → on: `favorites.add` + `dismissed.delete`; off: `favorites.delete`
     + `dismissed.add` (pin and unpin become exact opposites).
   - `dismissed` becomes a plain set of paths (drop the `{path: mtime}` map + the
     `isCleared` mtime comparison). Migrate existing keys to set membership.
   - Add the **auto-pin effect**: on `tree` change, add newly-qualifying paths to
     `favorites` (skipping anything already in `favorites ∪ dismissed`), persist.
   - `restoreNote` (Undo) re-pins: `favorites.add` + `dismissed.delete`.

2. **`Sidebar.tsx`**
   - **Delete** `PinnedSection` and drop it from render.
   - Replace `shortlistFor` (rank + cap + keepOff) with a **pinned-only selector**:
     per type, the notes whose path ∈ `favorites`, ordered sensibly (meetings by
     start time — soonest first; others by recency). No caps, no dismissed-filter
     (unpinned paths simply aren't in `favorites`).
   - `TypeSection`: **one** per-row action — the X (unpin). Remove the Pin button.
     Always render for the five rail types (even empty). Reuse the same component
     for temp categories (any non-rail type that has ≥1 pinned note).
   - `MemoryTree`: render list = the five rail types (synthesize empty groups as it
     already does for `note`) + one section per off-rail type with ≥1 pin. Rail
     types first in `RAIL_TYPES` order; temp categories after.
   - Keep the Undo strip (X is reversible for a few seconds).

3. **`NoteView.tsx`** — the Pin toggle already exists (line 143); it inherits the
   new "pin also un-dismisses" semantics. No structural change.

4. **Comments/naming** — the docstrings describing "the Pinned section", the
   shortlist caps, and the mtime re-surface behavior get rewritten to this model.

## Deliberately out of scope

- **Re-pinning on a *new* qualifying event.** Once the PO unpins something it's in
  `dismissed` and the auto-pinner leaves it alone forever — even if, say, a closed
  ticket reopens. Honoring a fresh transition would need per-note state tracking;
  defer until it's actually wanted.
- **Tuning the qualify rules per type.** The table above is a conservative first
  cut; expect to adjust which types auto-pin and how aggressively once it's on
  screen with the demo vault.
- **Pin state in the vault / cross-machine sync.** Pins stay client-side, as today.
