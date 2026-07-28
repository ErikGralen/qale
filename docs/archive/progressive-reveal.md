# Progressive reveal — the UI is exactly as big as the memory

**Decision (2026-07-27).** Produktminnet's first impression was a wall: five
always-on sidebar sections and a twelve-row Memory page, most of it empty on
day one. The fix is *earned reveal*: the librarian keeps filing every type from
day one, but a type only surfaces in the UI once the workspace actually holds
one. Low barrier (day 1 shows a calm two-section rail), high ceiling (week 6
shows the full instrument), and opinionated throughout — there is no settings
page for this. The only way to get a shelf is to feed the memory.

## The three calls

1. **Earned reveal, not configuration.** Types surface automatically the
   moment the memory first accretes one. Rejected: user toggles (blank-canvas
   trap), agent-proposed unlock cards (friction where we want momentum).
2. **The agent files everything regardless.** Visibility gates the UI only —
   never what the librarian writes. Revealing a type shows history that was
   quietly building; week 6 is fully accreted no matter what the UI showed.
3. **Earned stays earned.** A revealed type never hides again, even at zero
   notes. The memory accretes; so does the instrument.

## Mechanism

- `revealed(type) = CORE ∪ types the workspace has ever held`. Core is
  `meeting` + `note` (the between-meetings loop starts with a meeting and a
  scratch pad). `skill`/`todo` are exempt — they have first-class homes.
- Persisted per workspace in localStorage (`pm.revealed.v1:<vault>`), same
  mechanism as the pin set. View-only state; never a vault write.
- **Grandfathering:** the first launch against an existing workspace reveals
  everything present silently — only growth witnessed *after* that carries the
  one-time "new" mark (`pm.revealSeen.v1:<vault>` tracks acknowledgement).
- The "new" mark is a terracotta dot on the sidebar section header and a
  quiet `• New` next to the Memory-row count. Any click on the surface clears
  it. No modals, no toasts.

## Surfaces

- **Sidebar** (`Sidebar.tsx`): pin-gated, per Erik's follow-up (2026-07-27).
  Core (`meeting`, `note`) always shows and carries the day-one invitations;
  *every* other type — rail default or not — renders a section only while it
  holds a pin, and there is no "Nothing pinned." placeholder anywhere
  (anything in the sidebar IS pinned; unpinned categories live on the Memory
  page). Sections order by the working set first (ticket, decision, problem),
  then alphabetically. Empty Meetings invites "Drop a transcript ⇧⌘N" only
  when the memory holds no meetings at all; meetings-but-none-pinned shows
  the bare header as a browse affordance. The reveal ledger drives the Memory
  page and the "new" marks; the sidebar needs only pins. The old bottom
  "Empty workspace" paragraph is gone — the rail rows teach both actions.
- **Memory view** (`MemoryView.tsx`): revealed types cluster into four shelves
  — Record (meeting, source, session), Judgment (decision, insight, problem),
  People (customer, person), Delivery (ticket, release, wikipage) — with Notes
  alone on top as the desk. Empty shelf groups don't render. Unrevealed types
  fold into one footer sentence ("As the memory grows: …"). A fully empty
  workspace renders the first-run teaching state instead: Fraunces headline,
  the three-step loop (transcript in → approve cards → memory accretes), one
  terracotta CTA.

## Code map

- `renderer/src/lib/reveal.ts` — core/homed sets, `contentTypes`, load/persist.
- `renderer/src/state/app-state.tsx` — `revealed` / `revealNew` /
  `markRevealSeen` in context; earn effect on `[vault, tree]`; tree is cleared
  on workspace switch so the reveal ledger never reads a stale tree.
- `main/index.ts` — `PM_SCREENSHOT_DELAY` env (dev affordance added while
  verifying; default 2500ms).

## Copy facts

- Meetings do **not** contain transcripts — they link to them; transcripts
  are sources. The Memory row reads "Meetings and their After-Meeting reviews
  — transcripts live in sources."

## Verification notes (2026-07-27)

- Mature demo vault: everything grandfathers silently; Memory reads as four
  scannable clusters instead of a twelve-row wall.
- Day-1 empty vault: two-section rail + first-run Memory page.
- Earn + "new" marks: verified live (sidebar dot, `• New` row, auto-pin).
- Gotcha found while testing: **file:// (packaged) builds don't persist
  localStorage at all** — pins, tabs, and reveal state all reset per launch in
  `electron-vite build` output. Dev mode (localhost origin) persists fine.
  Pre-existing, affects every `pm.*` key, tracked here for a future fix
  (settings-service or IndexedDB migration).
