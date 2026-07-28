# External integrations (Jira + Confluence first) — external systems as projections of the memory

> Design plan, written 2026-07-22. UX-first: starts from the PM's jobs to be done and
> works backwards to sync mechanics. The outbound draft tools and `AtlassianClient`
> already exist; this plan is about the *experience* that makes them worth using.
> The model is **provider-generic** (`ticket` / `wikipage`, not `jira-issue` /
> `confluence-page`): Jira+Confluence is the first connector, Linear/Notion/GitHub
> Issues should slot in without touching the domain model or the UI.

## The user and the job

Our primary user is a PM whose real work happens in conversations — customer calls,
standups, steering meetings. Jira and Confluence are where that work has to be
*reported*: tickets filed, comments left, priorities nudged, spec pages kept honest.
The PM doesn't resent Jira because it's a bad tool; they resent it because updating it
is **bookkeeping about work that already happened somewhere else**.

Jobs to be done, in the PM's words:

1. **"After a meeting, make the tracker reflect what we just agreed."** Today: open
   Jira, hunt for the right epic, write a comment from memory, maybe file a ticket,
   maybe forget. 10–20 minutes, often skipped, so Jira drifts from reality.
2. **"Tell me where X actually stands."** Today: open Jira, search, read a comment
   thread, cross-reference with what the customer was promised. The answer lives in
   two systems and the PM's head.
3. **"Warn me when delivery and my commitments diverge."** Today: nobody does. The PM
   discovers the SSO epic went *Blocked* when the customer asks about it.
4. **"Keep the spec pages honest."** Today: Confluence pages silently rot after every
   decision. Everyone knows it; nobody fixes it, because finding *which* page a
   decision invalidates is the hard part.
5. **"Walk into the check-in already knowing what engineering did."** Today: a
   pre-meeting Jira scan the PM does manually, or doesn't.

Notice the shape: **every job is a reconciliation between what the PM knows and what
the external system says.** The memory already holds the PM's side (decisions,
commitments, meeting truth). The integration's whole purpose is to hold the other side
too, notice divergence in either direction, and propose the reconciliation — so the
PM's job shifts from *doing* the bookkeeping to *approving* it.

That's the 10x. The 100x is compounding: once tickets and pages are first-class
citizens of the memory, every existing feature gets them for free — meeting prep cites
live ticket status, `ask` answers delivery questions with evidence, weekly updates
report real transitions, commitment-check sees the blocked epic behind a slipped
promise. No new habits required; the PM's existing surfaces just get truer.

## Design principles (inherited, non-negotiable)

- **Reads are silent and free; writes are draft-and-approve, forever.** Pulling from
  Jira/Confluence never asks permission and never spams the Inbox. Pushing is only
  ever an outbound approval card. This is the existing hard floor
  (`docs/approval-review-redesign.md`) extended to sync.
- **Nudges live in their owning view.** A ticket that changed shows up on the release
  page, the meeting brief, the todo — not as an Inbox row. The Inbox stays an
  approval queue (per the commitment-check redesign: no interval sweeps, ever).
- **Never expose plumbing.** No JQL, no ADF, no "sync queue", no REST errors verbatim.
  The PM sees "PAY-142 · Blocked · changed by Mika, 2h ago", not a payload.
- **Every push carries provenance; every pull is attributable.** A pushed comment ends
  with a source line ("from the Nordkap check-in, Jul 14"); a mirrored change always
  names who changed it upstream and when.
- **The vault is the source of *intent*; Jira/Confluence are the source of
  *execution*.** We never pretend to own their data — mirrors are read-only locally,
  re-synced upstream, exactly like `source` notes today.

## The model: a local mirror as a new kind of source note

Mirrored external items become OKF notes in the raw layer — the same contract as
transcripts: **immutable locally, only ever updated by re-sync.** Two generic types,
deliberately not provider-named:

- `type: ticket` — a unit of tracked work (Jira issue, Linear issue, GitHub issue).
  Frontmatter: `provider` (`jira` | later `linear` | …), `external_id` (the key,
  e.g. `PAY-142`), `container` (project / team / repo), `state` (the provider's own
  label, shown verbatim: "In Review"), `state_category` (our normalized enum:
  `open | in_progress | blocked | done` — what chips, at-risk logic, and briefs key
  off), `assignee`, `remote_updated`, `url`, plus our own `summary` and `status` for
  the freshness spine. Body: description + recent comments as markdown (via the
  provider's converter, e.g. the existing `adfToMarkdown`).
- `type: wikipage` — a living document (Confluence page, Notion page). Frontmatter:
  `provider`, `external_id`, `container` (space / workspace), `version`,
  `remote_updated`, `url`. Body: the page as markdown.

The split that keeps this honest: **the domain and every UI surface speak only the
generic vocabulary** (ticket, wikipage, container, state_category); everything
provider-shaped lives behind a connector interface (auth, incremental pull, state
mapping, markdown conversion, outbound execution, URL/mention formats). `state` is
displayed raw so the PM sees their team's actual workflow words, but no logic ever
branches on it — logic branches on `state_category`, which each connector maps once.
The existing outbound payload's `system: 'jira' | 'confluence' | 'message'` becomes
`provider` + generic actions (`create_ticket`, `comment_ticket`, `update_page`) for
the same reason.

Why notes and not a side database:

- **`[[PAY-142]]` just works.** Wiki-links, backlinks, `[[` autocomplete, hover
  previews — the whole linking apparatus applies with zero new UI concepts.
- **The freshness spine applies.** When a mirrored issue changes on re-sync, its
  status resets to `new` and dependents go stale — which is *exactly* the drift
  signal jobs 3 and 4 need. We built this machinery for transcripts; tickets are
  just transcripts that keep talking.
- **`ask_product` and the librarian see them for free.** Cited answers about delivery
  status, link-repair pings, orphan detection — all inherited.

### Scope: track what the memory touches, not the whole instance

Nobody wants 4,000 mirrored tickets. Two scoping mechanisms, both visible in
Settings → Connections:

1. **Followed containers.** The PM picks projects (Jira) and spaces (Confluence)
   worth watching — for Tavla, the `PAY` project and the "Product" space. Within a
   followed container we mirror *shallowly*: key, status, title, assignee — enough
   for autocomplete and status pills, not full bodies.
2. **Deep-tracked items.** Anything actually *linked from a vault note* (a release
   note references the SSO epic; an outbound card filed a ticket and linked back)
   gets full-body mirroring and freshness participation. Linking **is** the tracking
   gesture — no separate "watch this ticket" chore.

This makes scope self-tending: the mirror deepens exactly where the PM's work touches
the external system, and stays shallow everywhere else.

### Pull mechanics (only as far as they shape UX)

- Piggyback the existing 5-minute scheduler tick: incremental pull (`updated >` last
  sync high-water mark) per followed container, serialized with the client's existing
  429 backoff. No webhooks in v1 — polling is invisible at this cadence and works
  without admin access to the Atlassian site.
- Offline / rate-limited: everything keeps working against the mirror; the only tell
  is a quiet "synced 4h ago" timestamp in Settings and on hover cards. Never a
  blocking error, never an Inbox card about sync health.
- **Conflicts can't happen on the mirror** (it's read-only locally). The one real
  conflict case: a pending outbound card drafted against a ticket that has since
  changed. The card gets a "PAY-142 changed since this was drafted" banner with the
  delta, and approval requires one extra glance. Cheap, honest, sufficient.

## Where it shows up: surfaces and scenarios

No new top-level view. Jira and Confluence appear where the PM already works. Each
scenario below uses the Tavla cast and maps to a job number.

### Inline references with live status (jobs 2, 5)

`[[` autocomplete extends to issue keys and page titles from followed containers.
A referenced issue renders as a chip — `PAY-142 · In Progress` — with the status pill
fed from the local mirror (instant, offline-capable). Hover: title, assignee, last
change ("Mika moved to In Review, yesterday"), open-in-Jira. The release note
`2026-07-sso-saml.md` links its epic once, and from then on every surface that shows
the release shows delivery truth.

### After the meeting: the tracker updates itself, pending one glance (job 1)

Sara Lindqvist confirms in the Jul 14 check-in that Nordkap needs SCIM group-mapping
before the September rollout. The `after-meeting` session already drafts decisions and
commitments; now it also drafts the *external* consequences, using the existing
`draft_jira_issue` / `draft_jira_comment` tools:

- **Card 1:** comment on the SSO epic — "Nordkap confirms first-tenant go-live
  Jul 28. Source: Nordkap check-in, Jul 14." Target line reads *"Comment on PAY-142 —
  SAML SSO (epic)"*, body previewed as Jira will render it.
- **Card 2:** new ticket in `PAY` — "SCIM group-mapping for Nordkap" with rationale
  and evidence chips pointing at the transcript.

The PM approves both in under thirty seconds. On approval the existing acceptance
path executes the API call and `linkBackPath` appends the created key to the meeting
note — so the memory records not just what was agreed but where it was filed. The
15-minute post-meeting Jira session becomes two taps, and it *actually happens every
time*, which is the part that compounds.

### Drift: delivery diverges from a promise (job 3)

Engineering moves the SSO epic to *Blocked* on a Thursday pull. The mirror note
updates; the freshness spine marks its dependents stale — including the todo "confirm
Jul 28 go-live with Sara" and the Nordkap-checkin meeting series. Where the PM sees
it: an at-risk marker on that todo in the Todos view, and a "since last time" line in
the next meeting brief. **Not** an Inbox card — per the commitment-check stance, the
memory flags risk in place and the PM decides when to act. When they do hit "Help me
handle this," commitment-check now *sees the blocked epic* and proposes a grounded
plan ("epic blocked on infra review since Tuesday — draft a date-risk note to Sara?")
instead of a blind reschedule.

### Confluence stewardship: pages that notice they're wrong (job 4)

The decision `2026-04-15-defer-scim-to-q3` exists in the vault; the "Enterprise
Onboarding" Confluence page still says SCIM ships in Q2. Because the page is mirrored
and linked from the enterprise-onboarding problem hub, the librarian can do what it
already does for internal links — but across the boundary: a prepared-fix card,
*"This page contradicts the SCIM deferral decision"*, previewing the edit as a
redline on the page's actual text, with the decision as evidence. Approve → the page
updates upstream with a provenance footer, and the mirror re-syncs. Confluence rot
becomes a stream of 10-second approvals instead of a quarterly archaeology project.

### Meeting prep and the weekly update, now grounded (jobs 5, 1)

`before-meeting` for the Nordkap check-in adds a delivery section from the mirror:
"Since Jul 14: PAY-142 In Review → Blocked; PAY-156 shipped." `weekly-update` drafts
the exec update from *actual ticket transitions* plus decisions — and its Confluence
publish target is just one more outbound card. The PM stops being the human diff
between systems.

## MCP or classic integration?

**Classic (direct REST via the existing `AtlassianClient`) for the sync engine and
outbound execution; MCP stays what it already is — our *server* for external
agents.** Reasoning:

- The mirror needs deterministic, incremental, schedulable pulls with backoff and a
  high-water mark. Atlassian's MCP server gives none of that — it's session-oriented
  tool-calling, wrong shape for a sync loop, and adds an auth hop we can't control.
- Outbound execution on approval must be exact and auditable (this payload, this
  endpoint, this link-back). A direct API call is the honest implementation.
- Our own MCP server (`ask_product`, `draft_writeback`) *benefits* from the mirror:
  external agents asking about delivery get cited answers from the local copy without
  us proxying Atlassian at all.

### Auth: API token v1 (researched 2026-07-22)

- **API token + Basic auth** is the only zero-setup path and is what v1 uses:
  the user creates a token at id.atlassian.com (≈60s), pastes site URL + email +
  token into Connections. No app install, no admin, no app registration. Stored
  like other secrets — honestly (per the secret-storage stance).
- Tokens now **expire (1–365 days, max 1 year** — pre-2024 eternal tokens die by
  May 2026). Expiry must be a designed-for quiet state: the Connections health
  line and hover cards show "token expired — paste a new one", the mirror keeps
  serving stale data, nothing errors loudly.
- **Scoped tokens** hit `api.atlassian.com/ex/{product}/{cloudId}/...`; unscoped
  hit the site URL directly — same Basic credentials. The connector probes both
  on connect so the user never has to know which kind they made.
- **OAuth 2.0 (3LO)** is the "sign in + approve" UX but requires *us* to register
  an app and a **client secret in the token exchange (no PKCE for public
  clients)** — a distributed desktop app can't hold that secret without a small
  relay service, which breaks local-first. Revisit if Atlassian ships PKCE.
  Rotating refresh tokens also expire after 90 days of inactivity.
- **JWT is not an option**: in Atlassian, JWT auth belongs to Connect apps, which
  an admin must install into the site — exactly the setup burden we're avoiding.

## Phasing

1. **Mirror + references.** Connections settings (connect, pick containers, health
   line), shallow mirror, deep-track-on-link, `[[` autocomplete, status chips and
   hover cards, `ask` coverage. *Value on day one: job 2 solved, zero write risk.*
2. **Outbound execution.** Wire acceptance of `ticket`/`wikipage` outbound cards to
   the connector's execute path + link-back; drafted-against-stale banner;
   after-meeting drafts external consequences. *Job 1.*
3. **Drift.** Mirror changes drive the freshness spine; at-risk todo markers;
   "since last time" in meeting briefs; commitment-check reads mirror context.
   *Jobs 3, 5.*
4. **Wikipage stewardship.** Librarian contradiction checks between the decision
   spine and mirrored pages; redline edit cards; weekly-update publish target.
   *Job 4 — the 100x compounding piece, and the hardest, hence last.*

## Work areas — how to split the build

Six areas with clean seams, so each can go to the right agent/skill and run mostly
in parallel. A is the shared contract everything else compiles against; B+C vs. D
vs. E/F are independent once A lands.

### A. Domain model (`packages/domain`) — the contract, land first

- New OKF types `ticket` and `wikipage` with the generic frontmatter above;
  raw-layer/immutable semantics; freshness-spine participation (mirror change →
  `status: new` → dependents stale).
- `state_category` enum and the rule that logic never branches on raw `state`.
- Genericize the outbound payload: `system` → `provider` + generic actions
  (`create_ticket`, `comment_ticket`, `update_page`), migration for existing
  proposal records/tools.
- Small, no UI, no I/O — pure types + zod. *Blocks everything; do it first.*

### B. Connector layer (`packages/connectors`, new) — provider adapters

- Define the `Connector` interface: `pullContainers()`, `pullChanges(since)` per
  container (shallow + deep), `fetchFull(id)`, `execute(outboundPayload)` →
  `{ externalId, url }`, `toMarkdown(raw)`, `mapStateCategory(state)`, auth
  config schema, health check.
- First implementation: Atlassian adapter wrapping the existing `AtlassianClient`
  (JQL incremental pull, CQL/v2 pages, `adfToMarkdown`, 429 backoff stays here).
- Pure I/O + mapping, no UI, no scheduling. Testable against fixtures. *Depends
  on A only. A future Linear connector is just a second file in this package.*

### C. Sync engine (main process, `apps/desktop/src/main`) — the loop

- Scheduler-tick piggyback: per-container high-water marks, shallow vs. deep-track
  resolution (scan vault links → promote to deep), mirror-note writer (the only
  code allowed to write `ticket`/`wikipage` files), search-index refresh.
- Outbound execution on card acceptance: route through connector `execute`,
  link-back append, drafted-against-stale detection (compare card's snapshot
  `remote_updated` vs. mirror).
- Sync-health state exposed over IPC (last sync per container, backoff status).
  *Depends on A + B. No UI — everything user-facing goes over IPC DTOs.*

**Built 2026-07-23** (`apps/desktop/src/main/services/sync-service.ts` +
`SyncStore` in the per-vault AppDb, `connections:*` IPC channels, a
`connections:changed` push event). Decisions made while building:

- **Per-container high-water marks + the shallow index live in app.db**
  (`sync_containers`, `sync_items`) — per-vault, so the demo vault's follows
  never leak into a real one. Losing a mark only costs a full re-pull.
- **Deep-track detection is a per-tick index scan**: bare `[[PAY-142]]`-style
  keys, `tickets/…`/`wikipages/…` slugs, and slugified-title matches for
  pages. Existing mirror notes stay deep even if the last inbound link goes —
  demotion is a human delete, never the engine's.
- **Mirror writer skips unchanged items** (same `remote_updated`/`version` as
  the note on disk), so re-pull slack can't churn commits or reset freshness.
  Tickets file as `tickets/<KEY>.md`, pages as `wikipages/<slugified-title>.md`
  — matching the demo mirrors byte-for-layout.
- **One connection (`atlassian`) in v1**; the DTO surface (providers list,
  connection list, auth fields from the descriptor) is already plural.
- **Outbound is ONE dispatch site**: `OutboundPort` narrowed to
  `execute(payload)`, implemented by the connector; the old Atlassian-shaped
  port methods are gone. `update_page` executes as a localized replace on the
  live page's storage XHTML (the card's `patch`), never a whole-body
  markdown round-trip; a provenance line rides along.
- Manual verification steps live in `docs/jira-demo-setup.md` §6.

### D. Frontend (renderer) — the frontend-skill agent's territory

- **Connections settings:** connect provider (token + site), pick followed
  containers, per-container "synced 4h ago" health line, disconnect. Generic UI —
  provider only contributes name/icon/auth-field labels.
- **Ticket chips + hover cards:** inline `[[PAY-142]]` rendering with
  `state_category` pill, hover card (title, raw `state`, assignee, "changed by
  Mika, 2h ago", open-external). Wikipage links get title + freshness hover.
- **`[[` autocomplete** extended with shallow-mirror items (key, title, state pill),
  visually distinct from vault notes.
- **Outbound card upgrades** in `CardItem.tsx`: target line ("Comment on PAY-142 —
  SAML SSO"), provider-true body preview, drafted-against-stale banner with delta,
  redline preview for wikipage edits (reuse the update-card diff rendering).
- **At-risk markers:** todo rows and meeting briefs surface stale/blocked linked
  tickets ("since last time" section).
  *Depends on A for DTO shapes; can build against mock IPC before C lands. All
  copy follows the approval-review rules: no plumbing, no jargon, glanceable.*

### E. Sessions & skills (`packages/sessions`, `packages/agent`)

- `after-meeting`: draft external consequences (comment/create ticket) with
  evidence + provenance footer.
- `before-meeting`: delivery section from mirror deltas since last meeting.
- `commitment-check`: read linked-ticket state as plan context ("epic blocked →
  draft date-risk note").
- `weekly-update`: ground in actual `state_category` transitions this week;
  wikipage publish target.
- Prompt/skill-file work + tool-surface tweaks; generic vocabulary only.
  *Depends on A; testable once C produces mirrors.*

### F. Librarian stewardship (`packages/application`, phase 4)

- Contradiction check: decision spine vs. deep-tracked wikipages → prepared-fix
  card (high confidence) or judgment-call ping (low), respecting existing ping
  caps and dedupe.
- The hardest LLM-judgment piece; isolate it so quality iteration doesn't touch
  sync or UI. *Depends on A, C, and the D redline preview.*

**Built 2026-07-22** (`use-cases/wikipage-drift.ts`, wired into the librarian
sweep). Decisions made while building, beyond the plan:

- **Candidate pairs are deterministic and cheap**: wikipage mirror notes linked
  from a problem hub / release / decision, paired with the ACTIVE heads of the
  decision chains in that orbit (superseded decisions ride along as prompt
  context only). The LLM sees a pair only after it exists AND its revision
  (decision mtime × page `version`) differs from the last recorded judgment.
- **A durable check ledger** (`sweep_checks` in app.db, `ctx.checks`) records
  every judgment by pair + revision. Consequences: an unchanged pair is never
  re-judged (no per-tick LLM spend), and a dismissed/rejected finding stays
  quiet until the decision or page actually changes — plus the standard 1-week
  quiet window when it does change soon after a dismissal. Unparseable model
  output is recorded too (fixtures are where prompt quality iterates, not a
  5-minute retry loop); transport errors are NOT recorded, so they retry.
- **One pending redline per page, ever.** Two decisions contradicting the same
  page would produce two full-body rewrites of the same text; the second pair
  isn't judged until the first card resolves (and an accepted card re-syncs
  the page, changing the revision anyway).
- **The confidence gate is code, not vibes**: prepared-fix status requires
  `confidence: high` AND a verbatim passage that anchors in the page body via
  the same whitespace-tolerant, ambiguity-refusing matcher as update cards.
  Everything else that still contradicts becomes a judgment-call ping. A
  rewrite the model marks ungrounded keeps fix status but is flagged
  `inference` (renders Unverified).
- Prepared drift cards share the librarian's 8-pending-fixes budget; a full
  queue defers judgment (nothing recorded) rather than spending it.
- Demo: `vault-dev/wikipages/enterprise-onboarding.md` (linked from the
  enterprise-onboarding problem hub) still promises SCIM in Q2 — the live
  sweep redlines it against `defer-scim-to-q3` when a key is configured.

## Open questions

- **Contradiction detection quality** (phase 4): decision-vs-page comparison is an
  LLM judgment; needs the evidence/Unverified treatment and probably a confidence
  gate before it earns prepared-fix status vs. judgment-call ping.
- **Comment volume on hot tickets:** mirror the last N comments, or summarize older
  ones into the body? Affects note size and `ask` quality.
- **Multiple Atlassian sites** (consultant PMs): out of scope v1, but the
  Connections UI shouldn't paint us into a single-site corner.
- **Do shallow-mirrored issues appear in `ask` results?** Lean yes (key + title +
  status is often the whole answer), but they must render distinctly from
  deep-tracked evidence.
