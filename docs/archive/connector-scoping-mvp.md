# Connector scoping — the MVP slice

> Build doc, 2026-07-28. **All four changes are built** — see the per-change "Built" notes for
> the decisions that only surfaced while writing them. The full thinking lives in
> `connector-scoping.md`; almost all of it stays parked. This was the lean cut: four small
> changes that make the existing follow model stop lying to the user. No new concepts in the UI,
> no new settings, no schema rewrite.
>
> The organising idea: **we already have two tiers, and they're the right two.** A cheap local
> index (never touched by an LLM, feeds autocomplete and status chips) and a small deep tier
> (full text, indexed, agent-visible) that only grows when the user links something. Nothing
> below changes that. It fixes the places where the tiers don't reach far enough or sort badly.

## The four changes

### 1. Track tickets by key, not only by project — *the important one*

**What's broken.** Everything the sync engine looks at comes from a followed container:
`SyncService.tick()` loops `store.followedContainers(...)` → `connector.pullChanges(container, …)`.
The promotion sweep right after it only walks `store.itemsByKind(...)` — rows that got there the
same way. So if a note contains `[[INFRA-88]]` and INFRA isn't followed, **nothing happens**. The
link is dead. `deepTargets()` correctly harvests the key from the vault index and then has
nowhere to send it.

That's the real gap. Linking is already the app's "track this" gesture — it just silently only
works inside projects you've followed.

**The change.** Keep a set of tracked external ids and pull them directly, independent of
containers.

- `SyncStore`: one new table.
  ```sql
  CREATE TABLE IF NOT EXISTS sync_tracked (
    provider    TEXT NOT NULL,
    kind        TEXT NOT NULL,           -- ticket | wikipage
    external_id TEXT NOT NULL,
    source      TEXT NOT NULL,           -- link | agent | blocker
    added_at    INTEGER NOT NULL,
    PRIMARY KEY (provider, external_id)
  );
  ```
  Plus `track(...)`, `untrack(...)`, `listTracked(provider)`.
- `Connector`: one new method, `pullByKeys(kind, ids: string[]): Promise<ShallowChange[]>`.
  Atlassian implements it as `key in (…)` JQL for tickets and `id in (…)` CQL for pages —
  **one request per batch of ~50 ids**, regardless of how many projects they span. Permission is
  handled for us: a key the user can't see simply doesn't come back.
- `SyncService.tick()`: after the followed-container loop, take
  `listTracked() ∪ deepTargets().ticketKeys`, drop anything a followed container already covered
  this tick, and pull the rest by key. Feed the results through the existing `upsertItem` +
  `writeMirror` path — the mirror writer doesn't change at all.
- Tracked items are **deep** (full body). The set is small and bounded by definition; if the user
  named a ticket, they want to know when it moves.

**Cost:** one extra request per tick, sometimes zero. **Benefit:** `[[ANY-KEY]]` works. This alone
covers "the other team's ticket we depend on" for anyone willing to type a key.

**Built 2026-07-28** — `sync_tracked` in `SyncStore`, `Connector.pullByKeys`, the Atlassian
implementation, and `SyncService.syncTracked()` running after the promotion sweep. Decisions
made while building:

- **A single bad id would have killed the whole batch.** Jira rejects the *entire* `key in (…)`
  query when one key doesn't resolve — so one typo'd `[[FOO-1]]` in a note would silently stop
  every tracked ticket from ever syncing again. `pullBatch` halves and retries on **HTTP 400
  only**, isolating and dropping the bad ids while the good ones still come back. Anything else
  (401/403/429/5xx/network) rethrows: an outage is about the connection, not the ids, and
  splitting on it would turn one request into a hundred.
- **Container is inferred, not fetched.** Jira keys are `PROJECT-N`, so a ticket pulled by id
  still knows its project. Confluence search doesn't report a page's space and we won't spend a
  request per page to learn it — `pullByKeys` returns a blank container for wikipages and the
  sync engine keeps whatever it already recorded rather than blanking a chip.
- **No high-water mark is possible** for an arbitrary id set, so the tracked pass re-reads the
  same handful of items every tick. That's fine: one request per 50 ids, and `writeMirror`
  already skips anything whose `remote_updated` hasn't moved, so there's no commit churn and no
  spurious freshness reset.
- **Items inside a followed container are skipped** in the tracked pass — their container's own
  incremental pull already covered them this tick.
- **Only ticket keys register from vault links.** Confluence page ids are opaque numbers nobody
  types, so wikipage tracking comes from the agent tool or the followed-space pull. The table
  supports both kinds; only one path populates it.
- `pullByKeys` is **optional on the `Connector` interface** — Google Calendar has no
  user-facing id worth typing, and the sync engine skips the tracked pass for it.

### 2. Auto-track blockers — one hop, blocking links only

`fetchFull` already parses `issuelinks` and hands back `full.links` with typed relations; today
they're written to frontmatter and otherwise dropped. When a deep item comes back with a
`blocks` / `is blocked by` edge pointing at a key we don't hold, add it to `sync_tracked` with
`source: 'blocker'`.

Guardrails, all of them load-bearing:

- **Blocking relations only.** Not `relates`, not `duplicates`. "Relates to" means whatever the
  person clicking it wanted it to mean, and following it walks half the instance.
- **One hop.** Never expand a blocker's own blockers. A messy epic will otherwise pull in
  hundreds of tickets on the second tick.
- **Cap the auto-added set** (~100). At the cap, stop adding and log it — silent truncation of a
  dependency set is exactly the kind of quiet incompleteness that makes the drift signal
  untrustworthy.
- **Never auto-remove.** If the blocking link later disappears, the item stays. It matches the
  existing rule that demotion is a human delete, and "what used to block us" is what you want
  when a date slips anyway.

**Built 2026-07-28** — `SyncService.trackBlockers()`, called from `writeMirror` right after
`fetchFull` returns. Decisions made while building:

- **"One hop" needed an actual mechanism, not just an intention.** An auto-added blocker gets
  its own mirror note, which runs `writeMirror`, which would harvest *its* links on the next
  tick — two hops, then three. The guard is a source check: we refuse to harvest from any item
  whose track source is `blocker`.
- **`SyncStore.track` upgrades but never downgrades the source.** `blocker` can't overwrite an
  explicit `link`/`agent`, so if the user later links a ticket we discovered automatically, it
  becomes a first-class tracked item and its own blockers get picked up. Without this the
  one-hop guard would permanently freeze anything we found first.
- Keys are validated against `TICKET_KEY_RE` before tracking — a site-configured link type
  pointing at something that isn't an issue key never enters the set.
- The cap is `BLOCKER_TRACK_CAP = 100`, and hitting it logs the key that was dropped.

### 3. Rank the autocomplete

`SyncStore.searchItems` currently orders by *key-prefix match, then `external_id` alphabetically*.
That means `PAY-12` — closed since 2019 — beats `PAY-3400`, which is open and assigned to you.
Following a busy project feels like a mistake purely because of this line.

Change the `ORDER BY` to a cheap score, all from columns that already exist:

1. exact/prefix key match (keep — it's how people type a key they already know)
2. `state_category != 'done'`
3. `remote_updated` desc
4. everything else

No new state, nothing to configure, nothing to maintain. This is the whole of the "archived" idea
from the discussion, and it should stay a computed sort — the moment tracked-vs-archived becomes
something users can set, it becomes something users have to maintain.

Same treatment for the wikipage half of the query (`remote_updated` desc is enough there).

**Built 2026-07-28** — `SyncStore.searchItems`, ORDER BY only. Wikipages have a null
`state_category`, which sorts with the open tickets rather than the done ones; that's the right
default and needed no special case.

### 4. A "keep an eye on this" tool for the agent

The live-search tools already exist and are wired: `jira_search`, `jira_get_issue`,
`confluence_search`, `confluence_get_page` (`packages/agent/src/tools.ts`, registered in
`runtime.ts` when a connection is active). So "let the agent look things up in Jira" is done.

What's missing is the ability to make a lookup stick. Add one tool:

```
track_external(kind, external_id)   →   "Now watching INFRA-88."
```

- **No approval card.** It writes nothing to Jira; it's us deciding to read something. Reads stay
  silent and free — the outbound hard floor is untouched.
- It writes a row to `sync_tracked` with `source: 'agent'` and triggers a tick.
- Front-end counterpart, if it's cheap: a "keep an eye on this" action on a live search result.
  If it isn't cheap, skip it — the tool alone is enough for the agent to be useful.

**Built 2026-07-28** — `track_external` in `packages/agent/src/tools.ts`, backed by
`SyncService.trackExternal()`. Decisions made while building:

- **The callback is injected through `AgentRuntimeConfig`, not built from the Atlassian
  client**, because tracking touches the sync engine (desktop main process), not the API client.
  It is deliberately *excluded* from `sameConfig` — it's identity-stable, and comparing it would
  tear down live sessions on every reconfigure the way a credential change does.
- The tool degrades to a plain "not available in this session" string when no callback is wired,
  so `ATLASSIAN_TOOL_NAMES` stays a single honest list.
- `trackExternal` kicks a tick and awaits it, so the agent's "now watching INFRA-88" is true
  when it says it, not aspirational.
- No front-end action yet — the tool alone earns its keep, and the renderer work belongs with
  the parked live-search surface.

**Also worth noting:** the Connections settings blurb already said *"Anything you link from a
note is watched closely, wherever it lives."* That sentence was false until change 1 landed. It
is now true, unchanged.

## Not in scope (parked in `connector-scoping.md`)

Listed so nobody rebuilds the argument later:

- The rings model as a user-facing concept. It stays an implementation detail.
- Ranked/pre-checked container picker with rationale strings.
- Boards, saved filters and Confluence page trees as followable scopes.
- The horizon bound on pulls (`updated > -90d`). **Deliberately dropped** — holding old rows is
  nearly free, and change 3 solves the actual problem, which was ranking, not volume. Revisit
  only if first-sync time on a real instance turns out to hurt.
- Size preview via `approximate-count`.
- In-context promotion offers ("Platform keeps showing up — watch their board?").
- Generalising `sync_containers` → `sync_scopes`.

## Invariants to hold while building

- **Shallow index rows never reach an LLM and never touch the freshness spine.** Only deep
  mirrors set `status: new` and cascade staleness. Changes 1 and 2 grow the deep tier, so this
  matters more than before, not less — keep the deep set to *linked* + *tracked* + *blockers*,
  and nothing else.
- **Reads never ask and never notify.** Tracking is a read decision, so no approval card, no
  Inbox row.
- **Never un-track behind the user's back.** Un-following a container drops its shallow rows;
  tracked items and their mirror notes survive.

## Order to build

1 → 3 → 2 → 4. Change 1 is the one that fixes a real broken behaviour; 3 is an hour and makes
change 1 pleasant to live with; 2 is the differentiator but leans on 1; 4 is the smallest and can
land whenever.

## What's verified, and what isn't

- **Fixture-tested** (`packages/connectors/test/atlassian-connector.test.ts`, 6 new cases):
  exact `key in (…)` JQL and `id in (…)` CQL on the wire, container inference from the key
  prefix, id de-duplication, the 400-halving isolation path, non-400 errors propagating without
  a retry cascade, and the no-network short-circuits.
- **Typecheck, lint and the full suite pass.** The skipped `@pm/vault` index tests are the
  pre-existing better-sqlite3 ABI thing, unrelated.
- **Not yet verified against a live site:** the tracked pass end to end (a `[[INFRA-88]]` link
  in an unfollowed project producing a mirror note), blocker discovery from real `issuelinks`,
  and `id in (…)` CQL against real Confluence. `pnpm reset-atlassian` seeds the demo site; the
  manual steps belong in `archive/jira-demo-setup.md` §6 alongside the existing ones.
- **Untested by design:** the autocomplete ordering is a SQL `ORDER BY`, checked by reading it.
