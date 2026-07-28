# External integrations — dispatch prompts for the six work areas

> Companion to `docs/jira-confluence-integration.md`. One copy-pasteable prompt per
> work area. Order: A first (it's the contract). Then B, C, D in parallel (D can mock
> IPC). E after A, testable once C runs. F last. Written 2026-07-22.

---

## Prompt A — Domain contract (`packages/domain`)

```
Read docs/jira-confluence-integration.md fully, especially "The model" and "Work
areas → A". You are implementing Area A only: the provider-generic domain contract
for external integrations. Pure types + zod, no UI, no I/O, no sync code.

Deliverables:
1. Two new OKF note types in packages/domain/src/notes/frontmatter.ts, raw layer
   (same immutability contract as `source`):
   - `ticket`: provider ('jira' for now, string enum built to extend), external_id,
     container, state (provider's raw label, display-only), state_category
     ('open' | 'in_progress' | 'blocked' | 'done'), assignee?, remote_updated, url,
     plus the standard summary/status fields so the freshness spine applies.
   - `wikipage`: provider, external_id, container, version, remote_updated, url,
     plus summary/status.
2. Genericize the outbound proposal payload in packages/domain/src/proposals/index.ts:
   zOutboundPayload currently has system: 'jira' | 'confluence' | 'message'.
   Replace with provider ('jira' | 'confluence' | 'message' stays valid data) plus
   generic action enum: 'create_ticket' | 'comment_ticket' | 'update_ticket' |
   'update_page' | 'send_message'. Keep reading old persisted records working
   (accept legacy field/values via zod transform — check how proposals are stored
   before deciding whether a migration is needed).
3. Update the agent tool layer (packages/agent/src/tools.ts: draft_jira_issue,
   draft_jira_comment, draft_confluence_update) and the MCP draft_writeback tool
   (apps/desktop/src/main/services/mcp-service.ts) plus packages/ipc/src/dtos.ts
   to emit the generic payload. Tool *names* may stay provider-flavored for now if
   renaming breaks skill files — check packages/sessions/src/defaults.ts for
   references and keep skills working.

Hard rules: no logic anywhere may branch on raw `state` — only on state_category.
Do not touch renderer code, the scheduler, or packages/atlassian.

Verify: pnpm check-types across affected packages; existing tests in
packages/application/test still pass; add zod round-trip tests for the two new
frontmatter types and the payload legacy-compat transform.
```

---

## Prompt B — Connector layer (new `packages/connectors`)

```
Read docs/jira-confluence-integration.md ("The model", "Pull mechanics", "Auth:
API token v1", "Work areas → B"). Area A (generic ticket/wikipage domain types)
is the contract — read those types in packages/domain first. You are building
Area B only: a new workspace package packages/connectors with a provider-agnostic
Connector interface and one implementation, Atlassian, wrapping the existing
client in packages/atlassian/src/client.ts (JQL search, CQL/v2 pages,
adfToMarkdown, serialized requests with 429 backoff — reuse, don't rewrite).

The Connector interface (design for a future Linear connector as just a second
file):
- authSchema: zod schema describing credential fields (Atlassian: siteUrl, email,
  apiToken) so the settings UI can render generically.
- verifyAuth(creds): probe and return identity/site info. Atlassian specifics:
  unscoped tokens hit the site URL directly; scoped tokens only work via
  https://api.atlassian.com/ex/{product}/{cloudId} (resolve cloudId via
  /_edge/tenant_info or accessible-resources). Probe both so the user never has
  to know which token kind they created. Distinguish auth-expired from
  network-down in the returned health state.
- listContainers(): projects (Jira) / spaces (Confluence) for the follow picker.
- pullChanges(container, sinceHighWaterMark): incremental shallow records
  (external_id, title, state, state_category, assignee, remote_updated).
- fetchFull(externalId): full body as markdown (description + recent comments for
  tickets; page body for wikipages).
- mapStateCategory(rawState): the one place provider states map to the generic
  enum. Jira: use the statusCategory field from the API (undefined/new→open,
  indeterminate→in_progress, done→done); flagged/blocked detection → 'blocked'.
- execute(outboundPayload): perform create_ticket / comment_ticket / update_page,
  return { externalId, url }. Body conversion markdown→ADF for Jira, storage
  format for Confluence.

No scheduling, no file writes, no UI — pure I/O + mapping. Test against recorded
fixtures (no live credentials in tests). Verify: pnpm check-types + the fixture
tests; document in the package README which REST endpoints are used.
```

---

## Prompt C — Sync engine (main process)

```
Read docs/jira-confluence-integration.md ("Scope", "Pull mechanics", "Work
areas → C"). Areas A (domain types) and B (packages/connectors) exist — read
their exports first. You are building Area C only: the sync loop and outbound
execution in apps/desktop/src/main.

Deliverables:
1. Sync service, piggybacked on the existing 5-minute tick in
   apps/desktop/src/main/services/scheduler-service.ts (same pattern as the
   librarian maintenance hook: idempotent, errors swallowed, never blocks the
   tick). Per-container high-water marks persisted in settings/DB.
2. Shallow vs deep tracking: followed containers sync shallowly (an index, not
   full notes — decide storage: sqlite table is fine, it feeds autocomplete);
   any external item actually wiki-linked from a vault note is promoted to a
   full mirror note. Scan links on sync, promote/demote accordingly.
3. Mirror-note writer: the ONLY code path allowed to write ticket/wikipage files.
   Writes OKF frontmatter per the domain types into e.g. external/<provider>/
   in the vault, sets status so the freshness spine marks dependents stale on
   change, refreshes the search index the same way other note writes do.
4. Outbound execution: on acceptance of an outbound proposal (see acceptOutbound
   in packages/application/src/use-cases/proposals.ts and
   apps/desktop/src/main/services/outbound-service.ts), route through the
   connector's execute(), then append the returned link to linkBackPath
   (mechanism already exists). Snapshot remote_updated on the card at draft time;
   expose a drafted-against-stale check comparing it to the mirror.
5. IPC surface (packages/ipc/src/dtos.ts + handlers.ts): connection CRUD +
   verifyAuth, container list/follow toggles, per-container sync health (last
   sync, auth-expired flag), shallow-index query for autocomplete, and the
   stale-draft check. Renderer consumes DTOs only — no provider types leak.

Hard rules: reads are silent (no Inbox cards, no dialogs from sync — health goes
in the DTO). Secrets stored the same way existing keys are. Respect the mirror's
read-only contract everywhere else in the codebase.

Verify: pnpm check-types; unit-test high-water-mark logic and promote/demote
against a fake connector; document manual verification steps (connect real site,
follow a project, see mirror notes appear, approve an outbound card end-to-end).
```

---

## Prompt D — Frontend (renderer) — for the frontend skill agent

```
Read docs/jira-confluence-integration.md ("Where it shows up", "Design
principles", "Work areas → D") and docs/approval-review-redesign.md (its hard
rules bind you: no storage/plumbing exposed, headlines plain-language ≤2 lines,
previews render like the note reads, actions always reachable). Area A's DTO
shapes in packages/ipc/src/dtos.ts are the contract; if Area C's IPC handlers
aren't ready, build against a mock IPC layer behind the existing preload boundary
and mark the seam clearly.

You are building Area D only, in apps/desktop/src/renderer:

1. Connections settings: connect a provider (fields rendered from the connector's
   authSchema — site URL, email, API token for Atlassian), verify on save with
   inline success/failure, list of containers with follow toggles, per-container
   quiet health line ("synced 4h ago"), and the token-expired state: a calm
   "token expired — paste a new one" affordance, never a modal or error toast.
   The UI is provider-generic; the provider contributes only name/icon/field
   labels. Don't paint into a single-provider or single-site corner.
2. Ticket chips: [[PAY-142]] wiki-links to ticket notes render as a chip — key +
   state_category pill (color by category, label shows the RAW state text, e.g.
   "In Review"). Hover card: title, assignee, "changed by <name>, <relative
   time>", open-in-provider link, and last-synced if stale. Wikipage links get
   title + freshness hover. Offline/expired: chips render from local data with a
   quiet stale indicator — never broken.
3. [[ autocomplete: extend the existing editor autocomplete with shallow-index
   items (key, title, state pill), visually distinct from vault notes, fed by the
   shallow-index IPC query.
4. Outbound card upgrades in components/inbox/CardItem.tsx: a target line
   ("Comment on PAY-142 — SAML SSO (epic)"), body preview, provenance/evidence
   chips as on other cards, drafted-against-stale banner showing what changed,
   and for update_page cards a redline preview reusing the existing update-card
   diff rendering.
5. At-risk surfacing: todo rows (TodosView.tsx) and meeting briefs show a marker
   when a linked ticket's state_category is 'blocked' or the mirror marked
   dependents stale; briefs get a "since last time" delta line. These live in
   their owning views — never add Inbox rows for pulled changes.

Verify: pnpm check-types for the renderer; demo against the Tavla scenario in
.vault-dev (PAY project, Nordkap SSO epic examples from the design doc).
```

---

## Prompt E — Sessions & skills (`packages/sessions`, `packages/agent`)

```
Read docs/jira-confluence-integration.md ("After the meeting", "Meeting prep and
the weekly update", "Drift", "Work areas → E"). Areas A–C exist: generic
ticket/wikipage notes mirror into the vault, outbound cards execute on approval.
You are updating skill files and tool surfaces only — Area E. Skills live in
packages/sessions/src/defaults.ts (and demo copies in vault-dev/skills/).

1. after-meeting: after drafting decisions/commitments, also draft external
   consequences — a comment on a linked ticket and/or a new ticket — via the
   outbound draft tools, always with evidence refs and a provenance line in the
   body ("Source: <meeting>, <date>"). Only when the meeting actually implies
   tracker changes; no reflexive cards.
2. before-meeting: add a delivery section — for tickets linked from this meeting
   series / its problem hubs, report state changes since the previous meeting
   ("Since Jul 14: PAY-142 In Review → Blocked").
3. commitment-check: when the todo links a ticket, read its mirror note; a
   blocked/stalled ticket becomes plan context ("epic blocked since Tuesday —
   draft a date-risk note?") instead of a blind reschedule.
4. weekly-update: ground the draft in actual state_category transitions this week
   (mirror notes carry remote_updated); offer an update_page outbound card as a
   publish target where a wikipage is linked.

Use only generic vocabulary (ticket, wikipage, state) in skill prose. Respect the
existing stance: user-initiated or session-bound, never interval-triggered; all
writes are approval cards. Verify: check-types; run each skill against the Tavla
demo vault and confirm sensible cards; update vault-dev skill copies and note
that pnpm refresh-demo re-seeds them.
```

---

## Prompt F — Librarian stewardship (`packages/application`)

```
Read docs/jira-confluence-integration.md ("Wikipage stewardship", "Work
areas → F", and the phase-4 open question on contradiction quality). Areas A–D
are in place. You are building Area F only: decision-spine vs wikipage
contradiction checks inside the existing librarian maintenance pass
(packages/application/src/use-cases/pings.ts — study its dedupe, pending caps
(max 5 pings / 8 fixes), and prepared-fix vs judgment-call split first).

1. Candidate selection is deterministic: only deep-tracked wikipages linked from
   a problem hub / release / decision chain, and only when the decision or the
   page changed since last check. Keep the LLM out of the loop until a candidate
   pair exists.
2. Contradiction judgment (LLM): does this page contradict this decision?
   High-confidence + localizable to a specific passage → prepared-fix card: an
   update_page outbound proposal whose preview is a redline on the page's actual
   text, with the decision as evidence. Low confidence or diffuse → judgment-call
   ping, not a card. Unsourced claims follow the existing inference/Unverified
   treatment.
3. Respect every existing constraint: dedupe against pending and
   recently-dismissed (1-week window), pending caps, errors swallowed, idempotent
   per tick. A page the user dismissed stays dismissed until decision or page
   changes again.
4. Quality isolation: put the judgment behind its own module with fixture tests
   (decision + page text → expected verdict) so prompt iteration never touches
   sync or UI code.

Verify: check-types; fixture tests for candidate selection and at least 6
judgment fixtures (clear contradiction, subtle, none, superseded decision chain);
manual: seed the Tavla vault's defer-scim-to-q3 decision against a fake
"Enterprise Onboarding" page and confirm one redline card, no dupes across ticks.
```

---

## Dispatch notes

- A is small — land and review it before starting anything else; every other
  prompt reads its types.
- B and C can go to the same agent sequentially if parallelism isn't needed
  (C depends on B).
- D is the frontend-skill agent; it can start immediately after A using mock IPC.
- E and F are prompt/LLM-quality work more than plumbing — review their output
  against the demo vault, not just types.
