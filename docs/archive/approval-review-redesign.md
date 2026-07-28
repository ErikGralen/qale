# Approval Review Redesign — context & PRD

> Handoff for a fresh session. The meeting-review approval flow is the single most
> important surface to demo. It is not good enough yet. This doc is the compaction:
> who it's for, what's wrong, the principles, the target, and where the code lives.

## TL;DR

A PM drops a meeting transcript and, seconds later, must confirm that their product
memory now matches reality. Today the approval cards still speak in **files, markdown,
slugs, and jargon** ("Update problem · problems/enterprise-onboarding.md", a raw
`## Decisions` / `[[decisions/2026-04-15-…]]` diff with `+`/`−` markers, a group title
that is literally the internal prompt). The PM is **not technical** — they don't know
what a `.md` file is, what a path is, or what "supersede" means. Rework the review so a
non-technical PM can, in ~90 seconds, read **plain-language statements of what changed in
their product truth** and approve them — with **zero files, paths, markdown syntax, or
jargon anywhere on screen**.

## Who this is for (user profile + JTBD)

**Profile.** One product owner / PM at a Nordic product company, adopting alone, between
meetings, in short bursts. Fluent in *product* (decisions, customers, problems, releases,
commitments). **Not fluent in the storage**: no mental model of files, folders, filenames,
slugs, markdown, frontmatter, git, or the word "supersede". Gives the app ~90 seconds after
a call. Values speed and trust; will either rubber-stamp (dangerous) or bail if a card is
opaque.

**Job to be done.** "I just had a meeting. Update my systems so they reflect what was
decided, learned, and promised — and stop stakeholders pinging me. Let me confirm the
changes fast, understanding *what* each one is and trusting it's right, without reading
anything technical." The meeting is "over" only when the memory is updated.

**Mental model (design to this).** The PM thinks in cause → effect:
> "A decision was made that conflicts with the old plan, so these few places are now out
> of date and need fixing. If that's right, make the edits. If it's wrong, don't — we'll
> do something else."
They do **not** think "apply an `update` proposal with a search/replace patch to
`problems/enterprise-onboarding.md`."

## Where we are (current state + what last session did)

Flow today: **Capture → land in the live After‑Meeting session (watch it work) → its cards
appear inline as approvable rows (`SessionReview`) and also collect in the Inbox.** A quick
model call names a titleless transcript at capture time.

Already done (keep): lazy-loaded previews; collapsed scannable rows with inline ✓/✕/expand;
"Approve all"; the sweep session relabeled "Repoint references"; the `supersedes` badge
reworded to "replaces"; inline-in-session approval; AI title at capture.

Still broken — see Problems. The remaining work is mostly about **speaking human**, not
layout polish.

## Problems (observed, with the exact examples)

1. **Header overflow → actions unreachable.** The group header is a non-wrapping flex row
   whose title uses `shrink-0` (`InboxView.tsx:441`), so a long title pushes "Approve all" /
   "Open session" off-screen behind a horizontal scroll. `SessionReview`'s header has the
   same risk.

2. **Group/session titles are internal prompt text with paths.** e.g. *"After‑Meeting — Run
   the after‑meeting session on meetings/2026-07-20-me-thanks-f…"* and *"Repoint references —
   A decision was just superseded (decisions/2026-04-15-defer-scim-…"*. The title is derived
   from the first 60 chars of the agent prompt (`runtime.ts:464`,
   `state.title = truncate(input.prompt, 60)`) — it leaks jargon, paths, and says nothing
   about **what to approve**.

3. **File paths / `.md` / slugs shown everywhere.** The card's secondary line is the file
   path (`insights/2026-07-20-entra-upn-claim-mapping-bug.md`); evidence chips are slugs
   (`decisions/2026-07-20-commit-scim-dates-nordkap`); the diff header says
   `Changes · problems/enterprise-onboarding.md`; wikilinks in the diff render raw
   (`[[decisions/2026-05-20-adopt-workos]]`). **The PM has no idea what any of these are.**
   Rule: never show a path, slug, extension, or "markdown".

4. **Headlines are mechanical and say nothing; the rationale paragraph adds no scannable
   value.** "Update problem · Enterprise Onboarding" (I took *"Update problem"* too
   literally) doesn't tell the PM *what* changes or *why*. The long rationale below
   ("Two changes: (1) the Decisions list entry is updated to show the new head with a
   supersedes note…") is dense, technical, and not glanceable. The PM wants the **effect in
   their language**: "Enterprise onboarding: SSO now shows as shipped and points to the new
   SCIM‑dates decision."

5. **Titles are clipped.** The most important glance-info is truncated mid‑phrase — e.g.
   "New insight · Our SSO claim mapping assumes email as name id…". An insight's subject *is*
   the point; clipping destroys it. Headlines must wrap (≤2 lines), never truncate.

6. **The change preview still shows raw markdown.** The `update` diff shows source
   (`## Decisions`, `## State`, `[[decisions/…]]`) with `+`/`−` gutters. The PM doesn't read
   markdown. It must render **as the note reads** (a heading, a list, links shown by their
   human name) with removed content in red/strikethrough and added content in green — **no
   `+`/`−`, no `##`, no `[[ ]]`.** ("We should NOT be showing `## Commitments`, we should be
   showing the *preview* of it.")

7. **Consequence edits are shown as disconnected cards.** When one decision makes several
   notes stale, the PM's model is *one cause, N effects*: "A new decision replaced the old
   plan → these 3 places need updating. Approve to make all 3; discard if the premise is
   wrong." Today they're N separate "Update problem" cards with no shared story.

## Design principles (hard rules)

- **Never expose storage.** No file paths, slugs, extensions, "markdown", "frontmatter",
  "patch", "diff", "supersede", "slug". Every note reference renders as its **human title**.
- **The headline is a plain-language statement of the change**, authored to be understood by
  a non-technical PM at a glance — declarative/imperative, one line, **wraps, never clipped
  mid-word**. It answers "what am I approving?" on its own.
- **Previews render like the note reads.** Rendered markdown; links shown as titles; changes
  conveyed by color + strikethrough only (removed = red/struck, added = green). No syntax,
  no gutters.
- **Cause-first grouping for consequences.** Present "because X changed, these N notes need
  updating" as one unit with a batch approve and per-item drill-in.
- **Speed & trust in ~90s.** The PM must grasp *what* and *why* instantly and trust it. Dense
  rationale, jargon, and truncation all break trust.
- **Layout serves the glance.** Title flexes/wraps; primary/secondary actions are always
  reachable (never behind a horizontal scroll).

## Target design

**Group header.** The meeting in human terms — the meeting's **display title** (e.g.
"Nordkap SSO check-in"), a relative time, and reachable actions. Never the prompt, never a
path. Title may wrap; actions `shrink-0` and stay visible (or collapse into an overflow
menu on narrow widths).

**Card (collapsed).** Icon + **human headline that wraps to ≤2 lines** (no path line
beneath). Inline ✓ approve / ✕ discard / expand. Examples:
- Decision: "Decided: commit SCIM dates for September — replaces the earlier 'defer to Q3'."
- Insight: "Learned: Sara says SSO must be live before August or Nordkap slips."
- Commitment: "You promised Sara the SCIM timeline by Friday."
- Consequence edit: "Enterprise onboarding: mark SSO as shipped, point to the new SCIM date."
- Outbound: "Send exec update: Nordkap SSO on track."

**Card (expanded).** A short **human "why"** (1–2 sentences, no jargon), then the **rendered
change preview**, then Edit / Chat. No paths, no raw markdown, links as titles.

**Consequence block (the sweep).** A cause header — "Because SCIM dates are now committed, 3
notes still describe the old plan" — with the affected notes nested by **human title**, each
drillable to its rendered change, and a single **Approve all / Discard** for the batch
(discard = "the premise is wrong").

**Rendered change preview (the hard part).** Target: show only the changed region(s),
rendered as the note reads, with removed spans red + struck and added spans green. Links
resolve to titles. Recommended approach: render the before/after of just the changed
block(s) with the existing `Markdown` renderer and tint them (old = red/struck, new =
green), rather than a raw line diff. Acceptable fallback if per-block rendered diffing is
too costly: render the **resulting** note region (green-tinted) plus a one-line human "what
changed", and drop the raw source view entirely. Never show `+`/`−` or markdown syntax.

## Model / plumbing changes this needs

- **Agent-authored human headline on every proposal.** Add a short `title`/`headline` field
  (plain language, ≤~80 chars, no paths/jargon) that the propose tools require and the skills
  prompt for. This becomes the scannable line; mechanical derivation (`cardMeta.describeCard`)
  is only a fallback. Touch: `packages/domain/src/proposals` (zod), `packages/ipc/src/dtos.ts`
  (DTO), `packages/agent/src/tools.ts` (propose_* tools), skills (`.vault-dev/skills/*`,
  `packages/sessions/src/defaults.ts`).
- **Slug → display-title resolver for the renderer.** Evidence refs, wikilinks in previews,
  the "replaces" badge, and any note reference must render the note's title. The index has
  titles server-side; expose a batch `note:titles(slugs)` IPC (or include titles in the DTO /
  evidence). Then render wikilinks-as-titles in previews and chips.
- **Human session/group titles.** Stop displaying the prompt-derived `session.title`. Derive
  the header from the anchor meeting/decision's display title (the Inbox already computes an
  `anchor`), or store a human title when firing the session. Touch: `runtime.ts` (session
  title), `handlers.ts` (session firing), `InboxView.tsx`/`SessionReview.tsx` (header).
- **Cause grouping for consequence edits.** Group the sweep session's cards under one causal
  header with a batch action. Either carry a `cause`/`reason` key on the cards, or treat the
  whole reaction session as one block.
- **Fix header layout.** `InboxView.tsx:441` title should shrink/wrap (`min-w-0 flex-1`, not
  `shrink-0`); actions `shrink-0`. Same for `SessionReview` header.

## Acceptance criteria

- No file path, slug, or `.md` is visible anywhere in the review UI.
- No raw markdown syntax (`#`, `[[ ]]`, `-`/`*` bullets as text) and no `+`/`−` in any
  preview; changes read as rendered content with color/strikethrough.
- Every card headline is a full human sentence, wraps to ≤2 lines, and is never clipped
  mid-word.
- The group/session header never causes horizontal scroll; "Approve all" / "Open" are always
  reachable.
- A supersede sweep reads as "Because X was decided, update these N notes" with one approve
  and per-item drill-in.
- A non-technical person can read any card and explain, unprompted, what approving it does.
- The two demo transcripts produce a review a PM can clear confidently in ~90s.

## File map (where to work)

Renderer (`apps/desktop/src/renderer/src`):
- `components/inbox/CardItem.tsx` — card anatomy, headline, preview, actions.
- `components/inbox/cardMeta.tsx` — headline/icon derivation (fallback), ordering, `stripFrontmatter`.
- `components/inbox/SessionReview.tsx` — in-session inline review + header.
- `app/InboxView.tsx` — group header (overflow bug at `:441`), grouping, keyboard nav.
- `app/ChatView.tsx` — renders `SessionReview` inline.
- `components/Markdown.tsx` — the rendered-preview renderer to reuse for change previews.
- `components/inbox/shared.tsx` — `WikiText` (wikilink → clickable), `outboundTarget`.

Main / packages:
- `apps/desktop/src/main/handlers.ts` — session firing (`fireSession`), `sessionLabel`, capture ingest + AI title, `session:status`.
- `packages/agent/src/runtime.ts` — session title (`:464`), `generateTitle`.
- `apps/desktop/src/main/dev-seed.ts` — no-key demo cards (`PM_SEED_PROPOSAL=1`) covering every kind; use for visual iteration.
- `packages/ipc/src/dtos.ts` — `ProposalDTO`, payload DTOs, `EvidenceRefDTO`.
- `packages/domain/src/proposals/index.ts` — payload zod schemas.
- `packages/agent/src/tools.ts` — `propose_*` tools (where a headline field is enforced).
- Skills: `.vault-dev/skills/*.md`, `vault-dev/skills/*.md`, `packages/sessions/src/defaults.ts`.

## Verify without an API key

```
PM_VAULT="$(pwd)/.vault-dev" PM_SEED_PROPOSAL=1 pnpm desktop
```
Seeds one card of every kind (insight, decision-with-"replaces", an edit with a change
preview, an outbound draft) so the review renders instantly. The full capture → session →
inline-approve path needs an Anthropic key.

## Open decisions for the next session

- **Human change preview**: per-block rendered diff (red/struck old + green new) vs. rendered
  result + one-line "what changed". Recommend attempting the former; fall back to the latter.
- **Headline source**: agent-authored field (recommended) vs. richer mechanical derivation.
- **Consequence grouping**: carry a `cause` key on cards vs. group the reaction session whole.
- Whether "Approve/Discard" wording should become more outcome-oriented (e.g. "Looks right" /
  "Not right").
