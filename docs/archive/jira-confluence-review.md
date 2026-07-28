# Jira/Confluence integration — code review

> Reviewed 2026-07-22 (working tree vs HEAD, ~3,300 lines across domain, connectors,
> application, main, renderer, sessions). Six parallel review passes, one per work
> area of `docs/jira-confluence-integration.md`; every finding below was verified
> against the actual code (and where relevant by executing it), not pattern-matched.
> Tests as of review: domain 44/44, connectors 14/14, application 37/37 pass;
> `@pm/desktop` type-check clean.
>
> **Addressed 2026-07-23** — all bugs (H1–H6, M1–M14, L1–L13) and improvements
> I2–I10 were implemented, plus refactors R1, R3–R8 and the R9 export; **Area C
> was built** (sync engine + `connections:*` IPC + mirror writer; see the
> "Built 2026-07-23" note in `docs/jira-confluence-integration.md` and
> `docs/jira-demo-setup.md` for the live-site verification arc). Left open by
> choice: I1 (deletion/move tombstones — needs the reconciliation-pull design;
> a suggestion, not a bug) and R2 (typed-generic connector execute seam — the
> R1 landing deliberately keeps the connector as the ONE payload parser, so the
> extra indirection buys nothing until a second connector exists).

## Status vs plan (the headline)

**Areas A (domain), B (connectors), D (renderer), E (sessions), F (wikipage drift)
are built. Area C (sync engine) is essentially not built** — and several bugs below
are latent only because of that:

- No scheduler-tick pull, no per-container high-water-mark persistence, no
  shallow/deep-track promotion, no mirror-note writer (nothing in the repo writes
  `ticket`/`wikipage` files; the demo mirrors are static `vault-dev/` files).
- `@pm/connectors` is imported by **nothing** — the connector, probe, and state map
  are dead code until C lands.
- The renderer runs against a mock seam (`lib/connections.ts` says so itself): the
  Connections panel, chips, hover cards, and stale banner are all fed by mock data.
- Only the outbound-execution slice is real, and it still goes through the old
  Atlassian-shaped `OutboundPort`, not the connector.

Consequence: the mirror `mutableFields` ("only re-sync writes these") currently have
exactly one writer — the human properties form — the opposite of the design.

---

## Bugs — high

### H1. Incremental JQL is syntactically invalid (missing `AND`)
`packages/connectors/src/atlassian/connector.ts:121-125`

The ticket branch joins clauses with a space:
`project = "PAY" updated >= "-38m" ORDER BY updated ASC` — Jira rejects this with a
JQL parse error. The Confluence branch embeds `AND` in its strings and is correct.
First sync works (no window clause), so **every pull after the first fails** — this
detonates the moment Area C wires the connector in. The tests pass because they
assert substrings (`jql.includes(...)`), which can't catch a missing joiner.

**Fix:** `` `AND updated >= "-${window}m"` ``, and change the test to assert the
exact full JQL string (the test header already claims it asserts "the wire shape").

### H2. `execute(update_page)` appends, but drift cards send the whole page → duplication
`packages/atlassian/src/client.ts:277-296` + `packages/application/src/use-cases/wikipage-drift.ts:386-407`

`client.updatePage` has append semantics (`currentBody + markdownToStorage(...)`),
but the librarian drift card's `body` is the **entire page with the redline
applied** (`applyPatch(pageBody, ...)`). Accepting a drift card appends a full
redlined copy of the page after the existing content. Compounding: `markdownToStorage`
only handles headings/bullets/paragraphs, so links, bold, tables, and `ac:` macros
in the round-tripped body get flattened to escaped text.

**Fix:** give `updatePage` an explicit `append | replace` mode driven by the
payload; for replace, patch the fetched storage XHTML directly using the verdict's
verbatim passage (avoids the lossy markdown round-trip entirely).

### H3. LLM transport errors are recorded as judgments, permanently suppressing drift findings
`apps/desktop/src/main/handlers.ts:104` + `packages/agent/src/runtime.ts:222-237`

`wikipage-drift.ts` assumes transport failures **throw** (so they retry); only
unparseable output is ledgered. But pi-ai's `completeSimple` never rejects on API
failure — it resolves with an error-stop message, and `completeText` never checks
`stopReason`, so a 429/529/network failure yields `''`. That empty string fails
`parseContradictionVerdict` and gets recorded in the check ledger at the current
revision — the pair is never re-judged until the decision or page changes. The
sweep test passes only because its fake `completions` throws; the real adapter
doesn't.

**Fix:** in `completeText`, `if (msg.stopReason === 'error' || msg.stopReason ===
'aborted') throw new Error(msg.errorMessage ?? 'completion failed')`. Belt-and-
braces: treat empty `raw` in `sweepWikipageDrift` as transport (skip, don't record).

### H4. `completeSimple` is called without an API key — title generation and drift judgments fail in packaged builds
`packages/agent/src/runtime.ts:206,236`

The user's key is stored as a pi-ai runtime AuthStorage override, but
`completeSimple(model, context)` with no `options.apiKey` falls back to **env vars
only**. With the key pasted into Settings and no `ANTHROPIC_API_KEY` in the
environment: `generateTitle` silently returns null every time, and `completeText`
throws an auth error on every drift judgment, every 5-minute tick (transport errors
deliberately retry). Works in dev where the env var is exported, which masks it.

**Fix:** `completeSimple(model, context, { apiKey: this.config.apiKey ?? undefined })`
or resolve via `modelRegistry.getApiKeyAndHeaders(model)`.

### H5. Retry after partial outbound success double-posts to Jira
`packages/application/src/use-cases/proposals.ts:404-419`

The connector call is inside `try/catch`, but link-back (`readNote`/`writeNote`/
`reindex`/`commitPaths`) runs after it and **before** `setStatus('accepted')`. If
link-back throws after the comment/ticket landed upstream, the IPC invoke rejects,
the card stays `pending`, and re-approving posts the comment twice / files a second
ticket.

**Fix:** `setStatus('accepted')` (persisting `out.url`) immediately after `execute`
succeeds; do link-back best-effort in its own `try/catch` (same pattern as
`markCitedSourcesProcessed`).

### H6. Commitment-check instructs `draft_message`, a tool it can't have
`vault-dev/skills/commitment-check.md:6` + `packages/sessions/src/defaults.ts:546`

The skill's Nudge option says "a draft_message the PO can send" (and the launch seed
reinforces it), but draft tools are only registered for `tier: outbound` sessions
(`runtime.ts:265,396`) and commitment-check is `tier: suggest`. The design's
flagship drift scenario ("draft a date-risk note to Sara?") can never execute — the
model emits an unknown-tool call or apologizes.

**Fix:** set `tier: outbound` on commitment-check in both `defaults.ts` and
vault-dev. Draft cards are approval-gated anyway, so the hard floor is unaffected.

---

## Bugs — medium

### M1. `update_ticket` is advertised everywhere but implemented nowhere
`packages/domain/src/proposals/index.ts:34`, `packages/ipc/src/dtos.ts:266`, `apps/desktop/src/main/services/mcp-service.ts:147`

It's in `OUTBOUND_ACTIONS`, the IPC union, rendered by `CardItem.tsx`, and
advertised to MCP agents in `draft_writeback` — but both `acceptOutbound`
(`proposals.ts:387-397`) and `AtlassianConnector.execute` (`connector.ts:235`) throw
`unsupported outbound action`. An agent can file a card the PM approves, which then
always fails with a plumbing error. Related: all target fields (`projectKey`,
`issueKey`, `pageId`) are optional in `zOutboundPayload`, so e.g. a `create_ticket`
without `projectKey` is filed, shown, approved — and fails only at approval, in two
word-for-word duplicated validation sites.

**Fix:** drop `update_ticket` from the enum + MCP description until implemented, and
add a `superRefine` (per-action required fields) so bad drafts are rejected at
filing time, where the agent can react.

### M2. Concurrent accept double-fires the external write
`packages/application/src/use-cases/proposals.ts:187-188`

`if (!rec || rec.status !== 'pending') return` is checked once at entry;
`acceptOutbound` then awaits a network call before status is written. Two
`proposals:accept` invokes for the same id (double-click, retry race) both read
`pending` and both execute.

**Fix:** synchronous in-flight `Set<string>` of proposal ids, or an atomic claim
(`UPDATE proposals SET status='accepting' WHERE id=? AND status='pending'`).

### M3. Ping-capped drift findings are ledgered as judged, then lost
`packages/application/src/use-cases/wikipage-drift.ts:432` + `pings.ts:271-275`

A `ping` verdict records `checks.set(...)` unconditionally, but ping creation
happens later in `runLibrarianSweep`, where the 5-pending cap can drop it. Next
tick the pair is skipped (same revision) — the finding is lost until the decision or
page changes. The fix budget gets this right (checked before judging, defers
unrecorded).

**Fix:** mirror the budget pattern — check ping capacity before judging, or only
`checks.set` when the ping is actually created.

### M4. No sweep reentrancy guard — concurrent sweeps can file two redlines for the same page
`apps/desktop/src/main/handlers.ts:88,226,534,543`

At launch both `afterOpen()` and the scheduler's first tick fire
`runLibrarianSweep`; sweeps also span minutes of LLM latency and can overlap the
next 5-minute tick. `sweepWikipageDrift` snapshots pending cards once at entry, so
two in-flight sweeps both pass the one-redline-per-page check and both file —
defeating "one pending redline per page, ever", plus duplicate LLM spend.

**Fix:** an in-flight promise guard around `runLibrarianSweep` (skip while running);
also drop one of the two launch triggers.

### M5. Superseding a directly-linking decision silently drops the drift pair
`packages/application/src/use-cases/wikipage-drift.ts:100-119`

Direct decision-linkers that are inactive are discarded (`if (!isActive(decision))
continue`) without walking `superseded_by` to the active head. If a page is linked
only from decision D1 and D2 supersedes D1, no (page, D2) pair exists — yet "page
still matches the old decision" is the flagship drift case. Only the hub topology
(via `problemRef`) rescues it, and only that topology is tested.

**Fix:** for an inactive paired decision, resolve the chain head via `buildChain`
and pair the head (chain rides along as context).

### M6. Drafted-against-stale has no real snapshot and no enforcement at accept
`packages/domain/src/proposals/index.ts` (payload), `proposals.ts:358-402`, `CardItem.tsx` (`OutboundDetail`)

The plan requires comparing the card's snapshot `remote_updated` vs. the mirror.
The payload carries no snapshot field; `acceptOutbound` performs no staleness check;
the renderer banner proxies with `Date.parse(meta.remoteUpdated) > created` — a
provider-clock vs local-clock comparison that mis-fires under skew and never fires
for cards drafted after the change but from pre-change content. Currently fed by
mock data. Same gap on drift cards: no `version` in the payload, so an upstream
edit between drafting and approval is clobbered wholesale.

**Fix:** add `remote_updated` (and `version` for pages) to payloads at draft time;
at accept, compare vs the mirror and return `{ ok: false, stale: true }` like
`acceptUpdate` does.

### M7. Update cards can rewrite mirror identity and immutable bodies
`packages/application/src/use-cases/proposals.ts:274-277`

`acceptUpdate`'s new `frontmatter` merge writes `{ ...note.frontmatter,
...frontmatter }` directly via `vault.writeNote` — bypassing
`checkFrontmatterMutation` and `isBodyEditable`, which `saveFrontmatter` claims all
frontmatter writes funnel through. An update card targeting `tickets/pay-142.md`
can rewrite `external_id`/`provider`/`url` or patch an immutable raw-layer body.
Related hole: `invariant.ts:91` includes `'type'` in the allowed-mutation set, so a
mirror can be retyped to `note` and thereby fully unlocked.

**Fix:** in `acceptUpdate`, reject `patch` when `!isBodyEditable(note.type)` and run
`checkFrontmatterMutation` before writing (ideally also at `propose_update` filing
time). Remove `'type'` from the allowed set in `invariant.ts` — unchanged types
compare equal and still pass.

### M8. Scoped-token probe never checks Confluence
`packages/connectors/src/atlassian/probe.ts:61-79`

The probe validates only the Jira gateway (`/ex/jira/{cloudId}/rest/api/3/myself`)
and assumes the Confluence base. A Confluence-only token is reported `auth-expired`
despite working; and whether the gateway accepts the site-style `/wiki/...` prefix
under `ex/confluence` is never exercised by probe or test — if wrong, every
Confluence call for scoped-token users 404s while `verifyAuth` says `ok`.

**Fix:** probe the wiki base too (`GET {wiki}/wiki/rest/api/space?limit=1`), record
per-product reachability, treat one-product tokens as partial-ok.

### M9. No pagination in the pull path
`packages/atlassian/src/client.ts:148,183-199,214`

`searchIssuesMeta` (single POST, max 100, ignores `nextPageToken`),
`searchPagesMeta` (limit 50), `listProjects`/`listSpaces` (hard cap 50, ignore
`isLast`/`_links.next`). Incremental pulls self-heal via ASC ordering + mark
advancement — but at 100 issues per 5-minute tick, first-syncing a 3,000-issue
project takes ~2.5 hours, and nothing documents that the healing depends on ASC.
`listProjects`/`listSpaces` do **not** self-heal: >50 projects silently truncates
the container picker.

**Fix:** loop on `nextPageToken` / `_links.next` / `start` with a page budget; at
minimum paginate the two list endpoints.

### M10. Unhandled promise rejection every scheduler tick
`apps/desktop/src/main/handlers.ts:226`

The maintenance callback is `void runLibrarianSweep(ctx).then(...)` with no
`.catch`; the scheduler's `try/catch` only covers synchronous throws.
`getMaintenanceReport`/`proposeLinkFixes` can reject (vault I/O), and drift
transport errors deliberately re-throw — so an `unhandledRejection` fires in main
every 5 minutes while offline.

**Fix:** append `.catch((err) => console.error('[pm] librarian sweep failed:', err))`.

### M11. Renderer connection lifecycle: renew discards the token, disconnect keeps it, empty state fabricates a connection
`apps/desktop/src/renderer/src/lib/connections.ts:341-362,404-411,439-455`

Three related holes in the mock-but-real-credentials seam: (1) `mockRenew` only
flips mock state — the pasted replacement token is discarded, so after expiry the UI
shows "synced just now" while Ask/outbound keep using the dead credential; (2)
`mockDisconnect` removes the mock entry but the safeStorage credential written via
`settings:setAtlassian` is never cleared (no clear channel exists) — "Disconnect"
lies; (3) `defaultMockState()` shows the hardcoded healthy `tavla.atlassian.net`
connection to every fresh user regardless of `hasAtlassianCreds`. Also
`mockConnect` stores the site URL unnormalized — `tavla.atlassian.net` without a
scheme fails in `AtlassianClient` later.

**Fix:** renew → re-call `settings:setAtlassian`; add a clear path and call it from
disconnect; seed the demo connection only when creds exist (or behind the demo
flag); prefix `https://` when missing.

### M12. `metaCache` never invalidates — chips and hovers freeze
`apps/desktop/src/renderer/src/lib/connections.ts:265-275`

Per-slug promises are cached forever: no TTL, no sync-event subscription, and
connect/renew/disconnect/setFollow don't clear it. Once Area C lands, a re-sync
changes nothing on screen until full reload; "synced 4h ago" silently grows stale.

**Fix:** clear on `connections:*` mutations and on a sync push event (the
`PUSH_CHANNELS` pattern exists), or short TTL.

### M13. Ticket-key regex false-positives turn ordinary links into dead chips
`connections.ts:160-167` + `Markdown.tsx:36-40` + `inbox/shared.tsx:26-28`

`/^[A-Z][A-Z0-9]{1,9}-\d+$/` matches `[[COVID-19]]`, `[[ISO-8601]]`, `[[Q3-2026]]`.
In read surfaces `isExternalRef` short-circuits **before** `note:resolveLink`, and
`ExternalRefChip`'s click handler is a no-op when meta is null — so such links
(including links to real vault notes that merely look like keys) render as chips
that do nothing. `NoteEditor.tsx:104-111` gets the order right (resolve first,
external fallback second).

**Fix:** when `refMeta` resolves null, fall back to `note:resolveLink(target)` +
`onOpen` (matching the editor), or resolve-first in the read surfaces.

### M14. `settings:setAtlassian` accepts anything, and `todo.overdue` is a dead event
`apps/desktop/src/main/handlers.ts:252-256`; `packages/sessions/src/skill.ts:43-48`

(a) Creds pass straight through unvalidated — empty strings persist as a truthy
`atlassian` record; the probe built for this is never called on save; no disconnect
channel. Fix: zod-validate (the `atlassianAuthSchema` in connectors already
exists), empty token → `atlassian: null`. (b) `todo.overdue` remains in
`SKILL_EVENTS` but its only dispatch site (`fireOverdueReactions`) was deleted in
this change — violating the invariant documented directly above the enum
("every event MUST have a live dispatch site"). Workspaces with an older
commitment-check skill file will show "runs automatically when a commitment slips
overdue" and it never fires. Fix: remove from `SKILL_EVENTS`/`EVENT_PHRASE`;
`parseBindings` then surfaces stale bindings honestly.

---

## Bugs — low

- **L1. Blocked-label heuristic outranks `done`** — `state-map.ts:16-21`: "Closed —
  Blocked" maps to `blocked` (the loud state) because the label test runs before
  the `done` category check, contradicting the file's own "never a wrong loud
  state" comment. Check `categoryHint === 'done'` first.
- **L2. Unparseable high-water mark freezes a container forever** —
  `connector.ts:49-53`: `Date.parse` NaN → window `-0m` → matches nothing, and the
  mark never advances. On NaN, treat the mark as null (full re-pull; upserts are
  idempotent).
- **L3. 429 backoff breaks on HTTP-date `Retry-After`** — `client.ts:115-118`:
  `Number(header)` → NaN → `sleep(NaN)` fires immediately (four hot retries); no
  cap either. `Number.isFinite(secs) ? Math.min(secs, 60) * 1000 : 2000`.
- **L4. Container ids interpolated into JQL/CQL unescaped** — `connector.ts:122,142`:
  not exploitable via today's `listContainers` output, but ids round-trip through
  persisted config with no quote-free contract. Add a `quoteJql()` helper.
- **L5. Confluence code blocks vanish from mirrors** — `client.ts:458-467`: turndown
  parses storage XHTML as HTML, so `<ac:plain-text-body><![CDATA[...]]>` becomes a
  bogus comment and code-macro contents disappear. Pre-process CDATA into `<pre>`,
  or convert from `body-format=export_view`.
- **L6. Exact-match `applyPatch` edits the first duplicate anchor** —
  `proposals.ts` (`applyPatch`): only the fuzzy fallback refuses ambiguity; a
  passage appearing twice verbatim gets one occurrence silently rewritten. Check
  for a second `indexOf` hit and return null.
- **L7. `pageId` fallback extends the quiet week to every pair on a page** —
  `wikipage-drift.ts:342-347`: after an **accepted** card, the re-synced page (new
  revision) can't be judged for 7 days. Quiet window only for `driftKey` matches;
  `pageId` fallback only for `status === 'pending'`.
- **L8. REST errors surface verbatim on cards** — `client.ts:120` +
  `proposals.ts:399-401`: `Atlassian 400: {raw json}` reaches the renderer,
  violating "never expose plumbing". Map at the port boundary (401/403 → "token
  expired — paste a new one"; network → "couldn't reach your Atlassian site").
- **L9. Confluence page id leaks in the stale banner; page refs won't resolve
  against real mirrors** — `CardItem.tsx`: banner prints `externalId` ("**910231**
  changed…") for wikipages (use `title`); `outboundRef` fabricates slug
  `wikipages/910231`, which real name-based mirror slugs won't match — `refMeta`
  needs lookup-by-externalId once Area C lands.
- **L10. Vault-note fallback meta claims perfect health** —
  `connections.ts:278-305`: hardcodes `stale: false, health: 'ok'` and casts
  `state_category` unvalidated (malformed value → `undefined` pill class). Apply
  the 12h staleness rule to `note.mtime`; validate against the enum.
- **L11. ConnectionsSettings load/submit polish** — no error/loading state on
  `reload()` (first-paint flashes the connect form; a real-IPC rejection silently
  shows the empty state); `TokenRenewal` Enter submits with empty fields (the
  Update button guards, Enter doesn't); Disconnect confirm has no busy state
  (double-fire).
- **L12. `remote_updated` schema vs properties form** — `frontmatter.ts:291`
  validates "ISO timestamp" as `z.string().min(1)`, and `properties-schema.ts:101-116`
  exposes it as an editable `date` widget — saving the form writes `YYYY-MM-DD`
  over the provider datetime that staleness detection compares. Tighten to
  `z.iso.datetime({ offset: true })`; see also I3.
- **L13. `transcriptTitle` returns transcript furniture** — `classify.ts:48-59`:
  pasted WEBVTT titles as "WEBVTT", SRT cue counter "1" as title, and mid-file
  continuation lines can be plucked as headings. Exclude `/^WEBVTT\b/` and bare
  numbers; only scan the first few lines. (Marginal to the integration; in-scope
  file.)

---

## Improvements

- **I1. No deletion/move/rename handling in the pull model** — `types.ts:59-67`:
  JQL/CQL only return still-existing, still-matching items; a deleted issue, an
  issue moved across projects, or an archived page leaves a permanently-stale
  mirror. `PullResult` has no tombstone/`presentIds` concept. Suggest a cheap
  periodic key-only reconciliation pull, and `fetchFull` mapping 404 → explicit
  `gone`.
- **I2. Hot-ticket comments: last-10 with no marker** — `connector.ts:170-177`: a
  100-comment epic mirrors as 10 comments with no "90 earlier comments" line,
  which will mislead `ask` citations. The response includes `total`; the honest
  line is nearly free.
- **I3. Mirror fields editable in the properties form** —
  `properties-schema.ts:101-119`: `state`, `state_category`, `assignee`,
  `remote_updated` get live widgets although the model says "read-only locally,
  only ever updated by re-sync" — a PM hand-flipping `state_category` creates
  exactly the drift the feature exists to catch. Add a read-only widget kind;
  keep only `summary`/`status`/`tags` editable.
- **I4. Provenance footer on page updates is missing** — the plan promises "the
  page updates upstream with a provenance footer"; neither `wikipage-drift.ts` nor
  the `update_page` accept branch appends one (unlike comment drafts' source
  lines). Also: three different provenance-line formats across the draft tools
  and skills ("Source: <meeting>, <date>" / "<session>" / "weekly update") — pick
  one canonical shape.
- **I5. Zero observability on drift failure paths** — `wikipage-drift.ts:433-435`
  and `pings.ts:222-224` swallow everything; a permanently-failing pair (e.g. page
  exceeding the context window) throws every tick, forever, at API cost,
  indistinguishable from "no drift". At minimum `console.error`; consider a
  per-pair failure count in the ledger to back off. Also no cap on judgments per
  tick (first sweep over N pairs = N sequential LLM calls).
- **I6. `system`/`provider` conflict parses silently** — `proposals/index.ts:61-63`:
  the preprocess only fills the missing side; `{system:'jira',
  provider:'confluence'}` parses with mismatched values read by different
  consumers. When `provider` is present, unconditionally overwrite `system`.
- **I7. Probe mislabels throttling as `unreachable`** — `probe.ts:87-95`: a 429
  from `/myself` reports `health: 'unreachable'` ("no server answered"). Safe
  direction, but one Retry-After respect in the probe would make `verifyAuth`
  reliable under load.
- **I8. `weekly-update` skill asks for data `vault_list` doesn't show** — the skill
  scopes by `remote_updated`, but `vault_list` rows omit it — one `vault_read` per
  ticket at scale. Surface `state`/`state_category`/`remote_updated` in
  `vault_list` rows for tickets, or make the sync-writer's summary convention an
  explicit contract.
- **I9. Hover card is mouse-only** — `ExternalRef.tsx:179-338`: an interactive
  tooltip ("Open the note", "Open at host") keyboard users can never reach.
  Either make it purely informational (chip Enter already opens) or manage focus
  into it. Related: `StaleDot`'s `aria-label` on a bare svg is unreliably
  announced — use visually-hidden text.
- **I10. Suggest-menu "link as typed" row visually joins the Tickets & pages
  group** — `wikilink-suggest.ts:110-132`: the ungrouped raw row renders directly
  under the group header. Give it its own group or reorder.

---

## Refactors

- **R1. Outbound dispatch exists twice — delete one before Area C creates a third
  caller.** `acceptOutbound` (`proposals.ts:385-398`, old Atlassian-shaped
  `OutboundPort`) and `AtlassianConnector.execute` (`connector.ts:206-237`)
  implement identical routing including identical `requires projectKey` guards.
  The code comments admit it's transitional. Narrow `OutboundPort` to
  `execute(payload): Promise<ExecuteResult>` and have `makeOutbound` return the
  connector. Bonus fix while there: the link-back line writes `p.title ?? out.url`
  where the plan says the **created key** (`PAY-171`) — the connector's
  `externalId` is exactly that.
- **R2. `Connector.execute(payload: unknown)` pulls the whole domain schema into
  every connector** — `types.ts:136-142`: each future connector must re-parse
  `zOutboundPayload` and know the flat provider-named fields. Cleaner seam: the
  sync engine parses once and calls execute with a typed generic action (generic
  `targetId` instead of three provider-named optionals).
- **R3. Hand-duplicated IPC unions with no drift guard** — `dtos.ts:21-25,41,262-266`:
  deliberate (`@pm/ipc` is dependency-free) but `update_ticket` shows how the
  contracts drift. Add bidirectional assignability assertions in a module that
  imports both (e.g. `apps/desktop/src/main/dto.ts`). Also `proposalToDTO` passes
  unparseable legacy payloads through raw while the DTO promises
  `action: OutboundAction` — worth a `payloadValid` flag.
- **R4. Provider branching hardcoded in generic UI** — `inbox/shared.tsx:60-66`:
  `if (provider === 'jira') return 'Jira'` — a Linear connector needs an inbox
  code change. The label should ride on the DTO or come from
  `connections.providers()` (which already carries `label`).
- **R5. Duplicated open-behavior in chips** — `ExternalRef.tsx:91-95,152-158`:
  `ExternalRefChip` and `AtRiskMarker` both implement "open notePath else
  window.open(url)"; the M13 fix lands in both — extract `openExternalRef()`.
- **R6. `REDEDUPE_MS` duplicated** in `pings.ts:39` and `wikipage-drift.ts:26` with
  a must-match comment; export one constant.
- **R7. `selectDriftPairs` is O(pages × notes × links) with live SQLite queries
  per link, every 5 minutes** — precompute one resolved-link map per sweep.
- **R8. Substring-based wire-shape tests** — `atlassian-connector.test.ts:120-123`:
  what let H1 ship green. Assert exact JQL/CQL strings.
- **R9. Minor:** `COMMITMENT_CHECK_SKILL` missing from `sessions/src/index.ts`
  named exports (every other skill constant is exported); mirror-reading
  boilerplate duplicated across four skill files (candidate for a shared guide
  paragraph); port assembly in `registerHandlers` accreting ad hoc (`makeOutbound`,
  `ctx.completions`) — a single `buildContextPorts()` factory before Area C adds
  mirror/sync ports.

---

## Verified clean (for the record)

- Legacy persisted outbound rows (`system` + `create_issue`/`add_comment`/`message`)
  normalize correctly at every read/accept point; no data migration needed; the
  new-shape parse is a fixpoint. Tools already emit the canonical
  `provider` + generic-action shape.
- Mirrors are correctly raw-layer with `bodyEditable: false`; `parseFrontmatter`
  round-trips tickets/wikipages and preserves unknown keys. All four demo mirror
  notes in `vault-dev/tickets/` and `vault-dev/wikipages/` validate against the
  real domain schema.
- Token storage is honest: safeStorage when available, declared-obfuscation
  fallback, `secretsEncrypted()` exposed, secrets never cross to the renderer,
  probe never logs the token.
- No XSS path for externally-sourced content: react-markdown without `rehype-raw`,
  node views use `textContent`, redline renderer builds React text nodes.
- The relative-window high-water design is sound (JQL bare datetimes are
  profile-timezone-local; relative `-Nm` windows sidestep it; ASC ordering
  self-heals truncation); check-ledger SQL and revision keys are correct;
  `state_category` → pill mapping matches the domain enum exactly; vault-dev skill
  files are byte-identical to the shipped defaults.

## Suggested fix order

1. **Before wiring Area C:** H1 (JQL), R1 (single dispatch), M9 (pagination),
   M8 (probe) — everything the sync engine will sit on.
2. **Live now, worst blast radius:** H3+H4 (drift sweep silently dead in packaged
   builds), H5+M2 (double-post), H2 (page duplication), H6 (commitment-check
   tier), M7 (mirror immutability).
3. **Quick wins:** M10 (`.catch`), M14b (`todo.overdue`), M1 (drop
   `update_ticket`), L1–L3, R6.
4. **With Area C's design:** M6 (snapshot staleness), M11–M13 (connections seam),
   I1–I3.
