# Tickets and wikipages beyond Atlassian

2026-08-23. Findings from a code audit, before any decision. The questions:

1. Can a user have the `ticket` type without a Jira connection?
2. Can two providers mirror tickets at once (Jira and Linear)?
3. Should `wikipage` exist without an integration? (Working answer: no. It stays
   connector-only, so it only needs the multi-provider work, not the local-type work.)

Two vocabularies matter here. A **provider** is the domain string in frontmatter
(`jira`, `confluence`). A **connector** is a connection the sync engine runs
(`atlassian`, `google-calendar`). One connector can serve two providers, which
is exactly what Atlassian does. The DB stores connector ids, frontmatter stores
provider strings. Keep the two words apart while reading this doc.

## What is already in good shape

The last genericization pass did real work. These need no change:

- **Domain vocabulary.** The types are `ticket`/`wikipage`, not issue/page. The
  outbound actions are `create_ticket`/`comment_ticket`/`update_page`, with a
  legacy shim for old `create_issue` rows (`domain/src/proposals/index.ts:67`).
- **Provider enums with a declared growth path.** `TICKET_PROVIDERS = ['jira']`
  (`domain/src/notes/frontmatter.ts:442`). Adding `'linear'` is one line, and
  `mirrorSource` already prefers the note's own `provider` field over the enum
  (`edit-layer.ts:62`). `PROVIDER_LABEL` in the inbox has a capitalize fallback.
- **Normalized state.** Logic branches only on `state_category`
  (open/in_progress/blocked/done); the raw `state` string is display-only. Each
  connector maps its workflow labels once. This is the right shape for Linear.
- **The sync store.** Every table (`sync_containers`, `sync_items`,
  `sync_tracked`, `sync_series`) is keyed `(provider, id)` and every method takes
  a provider argument (`vault/src/sync-store.ts`). One caveat below.
- **The wire surface.** `ProviderDescriptorDTO`, `ConnectionDTO` (a list, not a
  pair), the `connections:*` IPC channels, and `ConnectionsSettings.tsx` all
  render from data. A third connector shows up in Settings with no UI work.
- **The Connector interface.** `verifyAuth` / `listContainers` / `pullChanges` /
  `pullByKeys` / `fetchFull` / `mapStateCategory` / `execute` is a clean contract
  a Linear connector can implement (`connectors/src/types.ts:159`).

## Question 1: a ticket without Jira

This is a product decision before it is a technical one.

The current model says a ticket **is** a mirror, by definition, not by
circumstance:

- The schema requires `provider` (enum: jira), `external_id`, `container`,
  `state`, `state_category`, `remote_updated` (ISO datetime), and `url`
  (`frontmatter.ts:462`). A local ticket has none of these.
- `isMirrorType` is keyed on the **type**, not the note (`edit-layer.ts:43`).
  Every ticket is body-read-only ("Mirrored from Jira. Edits happen there."),
  and `TYPE_RULES.ticket.bodyEditable = false` (`invariant.ts:67`).
- Ticket is excluded from `HAND_CREATABLE_TYPES` with the stated reason "nobody
  authors them" (`edit-layer.ts:123`). No new-ticket affordance exists anywhere.
- The sync engine is the only writer of `tickets/`. `TicketBoard.tsx:32` parses
  the exact `"KEY · Title"` format the sync writer emits, so a hand-made ticket
  renders oddly.
- The product already has a stance: `theme` is "deliberately NOT a ticket"
  (`frontmatter.ts:341`), and `todo` holds the PM's own work. The local homes
  for work exist.

So "let users make tickets without Jira" contradicts four deliberate design
statements. The technical cost is real but bounded; the conceptual cost is the
bigger one.

**If we do want it**, the honest shape is a schema split, not a loosening:

- A discriminated variant: `provider: 'local'` (or absent) with
  `external_id`/`url`/`remote_updated` dropped and `state_category` kept. Do not
  make the mirror fields optional on one schema; that lets a sync write a
  half-mirror and a user edit a real one.
- `isMirrorType` becomes per-note: mirror when the note carries a real provider.
  `editLayerForType` and `TYPE_RULES` then need the same per-note split, which
  breaks the current "one axis, fully derivable from type" property the edit
  layer is built on (`edit-layer.ts:15`).
- Add ticket to the hand-creatable set, fix the FolderView empty copy ("Jira
  issues the agent tracks appear here", `FolderView.tsx:65`), and stop
  `TicketBoard` assuming the sync title format.

**Recommendation:** decide first what a connector-less "ticket" is that a todo
or a theme is not. If the answer is "a backlog the PM owns", that may be a new
need worth this cost. If the answer is "a task", the type already exists.

## Question 2: two providers at once

The domain and storage layers are ready. The wiring is not: the app is
structured as "exactly these two connectors", and several generic seams were
built and then never connected.

### Dead seams: built for this, never wired

Cheap to fix, and worth fixing even before any Linear work, because they are
the difference between "add a connector" and "edit forty call sites".

- `CONNECTOR_PROVIDERS` (`connectors/src/index.ts:37`) is the registry the
  settings UI is supposed to iterate. Nothing consumes it. The sync service
  hardcodes its own duplicate descriptors instead (`sync-service.ts:88`).
- `Connector.providers` (`types.ts:163`) exists to tell the sync engine which
  provider string to stamp on a mirror. It is never read. `writeMirror`
  hardcodes `provider: 'jira'` and `provider: 'confluence'`
  (`sync-service.ts:981,1001`). This is the exact line that would write the
  wrong provider on a Linear mirror.
- `settings:setAtlassian` (`ipc/src/index.ts:104`) duplicates
  `connections:connect('atlassian', …)`. Two write paths to the same slot.

### Structural blockers, in dependency order

1. **Credential storage is a named slot.** `SettingsService.data.atlassian` is
   one object (`settings-service.ts:115`). A second tracker has nowhere to put
   its token. Needs `connections: Record<connectionId, {providerId, fields}>`.
2. **The sync service is a two-key literal.** `conns: Record<'atlassian' |
   'google-calendar', ConnectionState>` (`sync-service.ts:157`), a hardcoded
   tick loop (`:566`), and roughly forty `'atlassian'` string literals across
   connect/disconnect/track/drift/health. This is the bulk of the work: turn
   the record into a map built from the registry, and thread `connectionId`
   through every call that now passes the literal.
3. **Outbound dispatch falls through to Atlassian.** `makeOutbound` takes
   positional per-provider arguments and routes "google-calendar, else
   Atlassian" (`outbound-service.ts:38`). A `provider: 'linear'` payload would
   be handed to the Atlassian connector. Needs a `Map<provider, Connector>`
   built from live connections, and a real error for an unknown provider.
4. **The agent runtime has one tracker slot.** `AgentRuntimeConfig.atlassian`,
   a single `atlassianActive` boolean gating tool exposure
   (`runtime.ts:172,457`), and a direct dependency on `@qale/atlassian`
   (`package.json:17`). The gate needs to become per-connection capabilities.
5. **The provider is chosen by tool name.** `draft_jira_issue`,
   `draft_jira_comment`, `draft_confluence_update`, `jira_search`,
   `confluence_get_page` (`tools.ts`). The names are baked into the shipped
   skill files (`sessions/src/defaults.ts`, 14 places), the SessionView verb
   switch (`SessionView.tsx:164`), and telemetry words. Two options: mint
   per-provider tool sets from the registry, or genericize to `draft_ticket`
   with a provider parameter. Either way the skill copy moves in the same
   change, and old session transcripts keep the old names.
6. **External identity has no provider namespace.** Mirror paths are
   `tickets/<external_id>.md` (`sync-service.ts:947`), `itemByExternalId`
   takes no provider (`sync-store.ts`), and `findOutboundMirror` matches on
   `external_id` alone (`proposals.ts:658`). Jira `PAY-142` and a Linear
   `PAY-142` would collide silently. Linear keys are also Jira-shaped
   (`ENG-123`), so `TICKET_KEY_RE` (`sync-service.ts:52`, duplicated at
   `renderer/lib/connections.ts:41`) cannot tell them apart. This is the one
   place multi-provider forces a data-model decision, not a refactor: either
   paths gain a provider segment (`tickets/linear/ENG-12.md`) or the flat path
   stays and every lookup gains a provider argument. Note the same regex is
   the app-wide "is this `[[ref]]` external?" heuristic in seven renderer
   files, and GitHub-style refs (`repo#12`) would not match it at all.
7. **Fixed two-key shapes at the edges.** Onboarding
   (`OnboardingDTO.connections: {google, atlassian}`, `dtos.ts:811`;
   `FirstSteps.tsx:279` has a hardcoded "Connect Jira or Confluence" row),
   telemetry (`CONNECTION_PROVIDERS = ['google','atlassian']`,
   `ipc/telemetry.ts:162`; unknown providers report nothing), and
   `SettingsDTO.hasAtlassianCreds` (`dtos.ts:851`).

### Shallow but wide: the rename layer

`issueKey` and `pageId` are provider-shaped names on the supposedly generic
outbound payload (`domain/src/proposals/index.ts:108`). They are read by the
accept path, the connector dispatch, the inbox card, MCP, and dev-seed. A
rename to `targetId` is mechanical and the legacy-payload preprocess step is
already the place to normalize old rows, but it touches all of those at once.
Same bucket: user-facing copy that names Jira/Confluence where it should name
the note's provider (`CardItem.tsx:576` hardcodes "Jira ticket"/"Confluence
page" on evidence chips; `RunnableConfig.tsx:32` permission rows;
`index-files.ts:41` writes "(Jira)" into vault index files;
`ExternalRef`/`ContextView` labels follow the domain fix for free).

### Bugs found on the way (real today, worse with two providers)

- **Wikipage path collisions.** `wikipages/<slug(title)>.md` has no uniquifier.
  Two pages with the same title in different spaces clobber each other
  (`sync-service.ts:947`). Meetings got the `-2..-9` suffix treatment
  (`:733`); wikipages did not.
- **`mirrorSource` degrades to prose.** With two entries in a provider enum and
  no `provider` in frontmatter, the label becomes the literal string "the
  source system" (`edit-layer.ts:70`). Fine as a fallback, worth knowing.
- **Google smuggles a cursor through `highWaterMark`.** The field is documented
  as an ISO timestamp but carries `v2|<ms>|<syncToken>` for Calendar. The type
  is fine; the doc comment lies (`connectors/src/types.ts:93`).
- **Atlassian vocabulary inside the generic interface.** `VerifyResult.site.cloudId`,
  `tokenKind: 'unscoped'|'scoped'`, and `products` (`types.ts:140`). Optional
  fields, shallow to generalize.

## Plan: PD-1 to PD-13

**Status: all 13 tickets implemented 2026-08-24.** Every ticket landed with
`pnpm test` and `pnpm check-types` green (825+ tests, 8 packages). Still owed:
a live run against the real Atlassian site (connect, tick, outbound accept,
and the one-time flat-mirror migration on a real vault). Nothing committed.

Scope: make the codebase provider-ready. Building an actual Linear connector
is out of scope; after this plan it is one connector class, one
`ConnectorProvider` registration, and one entry in `TICKET_PROVIDERS`.

Defaults taken without a ticket of their own (veto in review):

- Existing flat mirrors migrate into provider subfolders on the first sync
  tick after PD-10 lands. No flat/nested mixed state.
- The `issueKey`/`pageId` → `targetId` rename is in scope (PD-9). Old stored
  payloads normalize in the existing zod preprocess step; no data migration.
- The Google OAuth grant keeps its own settings slot. The new `connections`
  map covers field-auth connectors; folding OAuth grants in is follow-up work.
- Old session transcripts keep rendering: SessionView keeps legacy entries for
  the retired tool names.

Order: PD-1..2 are independent and safe now. PD-3 → PD-4 → PD-5 is a strict
chain. PD-6 and PD-7 need PD-4. PD-8 → PD-9. PD-10 → PD-11. PD-12 is
independent copy work. Every ticket ends with `pnpm test` and
`pnpm check-types` green; live verification happens once at the end against
the real Tavla Atlassian site (`pnpm reset-atlassian`).

### Phase A: stop the rot (no behavior change)

**PD-1: Wire the dead seams.**
`writeMirror` reads `connector.providers[kind]` (`connectors/src/types.ts:163`)
instead of the literals at `sync-service.ts:981,1001`. `providers()` derives
its descriptors from `CONNECTOR_PROVIDERS` (`connectors/src/index.ts:37`):
move the descriptor data (label, auth fields, `renewFieldKeys`, `authKind`)
into each `ConnectorProvider` in the connectors package, delete
`ATLASSIAN_DESCRIPTOR`/`GOOGLE_DESCRIPTOR` from the sync service. Delete the
`settings:setAtlassian` IPC channel (`ipc/src/index.ts:104,349`,
`handlers.ts:1251`) after migrating its renderer callers to
`connections:connect`. Done when: no `'jira'`/`'confluence'` literal remains
in `sync-service.ts`, `CONNECTOR_PROVIDERS` has a consumer, and mirror
frontmatter output is byte-identical to before.

**PD-2: Wikipage path collision fix.**
`wikipages/<slug>.md` gets the same `-2..-9` uniquifier meetings have
(`sync-service.ts:733` is the pattern, `:947` is the gap). Two same-titled
pages in different spaces must land as two files. Add a regression test in
the sync-service tests. This is a live bug; ship it regardless of the rest.

### Phase B: many connections

**PD-3: Generic credential storage.**
`settings-service.ts:115` `atlassian: {...} | null` becomes
`connections: Record<connectionId, { providerId: string; fields: Record<string, string> }>`
with values encrypted as today. Migrate the existing `atlassian` slot on
load. Keep `getAtlassian()` as a thin adapter over the map so PD-4 can land
separately; delete it in PD-4. `hasAtlassianCreds` (`dtos.ts:851`) becomes
derived. Done when: an existing settings.json round-trips, connect and
disconnect still work, secrets stay encrypted.

**PD-4: Registry-driven sync engine.**
The core ticket. `SyncService.conns` (`sync-service.ts:157`) becomes a map
built from `CONNECTOR_PROVIDERS` + stored connections. The tick loop
(`:566`), connect/renew/disconnect/setFollow/recommend guards, drift keys
(`:71,84`), container offers, track calls, health reads, and
`shallowToRow` lose their `'atlassian'` literals: thread `connectionId`
through instead (about forty sites; the audit above lists them). The
`providerId === 'atlassian'` gates on deep-sync and promotion become
capability checks (`connector.pullByKeys != null`). Done when: `grep -w
atlassian sync-service.ts` returns nothing outside comments, and both
existing connectors behave as before under the fixture tests.

**PD-5: Outbound dispatch by provider.**
`makeOutbound(atlassianCreds, googleAuth)` (`outbound-service.ts:21`) becomes
`makeOutbound(connectors: Map<providerString, Connector>)` built from live
connections in `reconfigureAgent` (`handlers.ts:507`). Routing matches
`payload.provider` exactly; an unknown provider is a card-failure error, not
an Atlassian fallthrough. The no-port error text in `proposals.ts:585` stops
naming Atlassian. Done when: a `provider: 'linear'` payload fails with a
clear error instead of hitting the Atlassian client.

**PD-6: Onboarding and telemetry shapes.**
`OnboardingDTO.connections` (`dtos.ts:811`) keyed by providerId instead of
the fixed `{google, atlassian}` pair; `FirstSteps.tsx:279` derives its
connect rows from `connections.providers()`. Telemetry: replace the closed
`CONNECTION_PROVIDERS` list (`ipc/telemetry.ts:162`, `handlers.ts:1291`)
with the providerId itself (it is not personal data). Done when: a third
registered provider shows up in onboarding and telemetry with zero edits.

**PD-7: Generalize the connector interface edges.**
`VerifyResult.site.cloudId`/`tokenKind` and `products` (`types.ts:140-147`)
become provider-neutral (`site.detail?: Record<string,string>` or similar);
fix the `highWaterMark` doc comment (`types.ts:93`) to say "opaque cursor".
Small, no behavior change.

### Phase C: the agent stops saying Jira

**PD-8: Per-connection capabilities in the runtime.**
`AgentRuntimeConfig.atlassian` and the `atlassianActive` boolean
(`runtime.ts:172,457,525,1015,2060`) become a list of active connections with
capabilities (read, draft, track). Read tools move behind the registry: the
connectors package exposes each provider's read toolset (the four Atlassian
read tools relocate from `agent/src/tools.ts:2450` next to their connector),
and `packages/agent` drops its direct `@qale/atlassian` dependency
(`runtime.ts:29`, `package.json:17`). Tool names stay as they are
(`jira_search` etc.) since query syntax is provider-specific by design.
Done when: `@qale/agent` has no import from `@qale/atlassian`, and tool
exposure follows connections, not one boolean.

**PD-9: Generic write tools.**
Replace `draft_jira_issue`/`draft_jira_comment`/`draft_confluence_update`
(`tools.ts:2016-2227`) with `draft_ticket(container, title, body, kind?)`,
`draft_ticket_comment(ticket, body)`, `draft_page_update(page, ...)`. The
handler resolves the provider from the mirror's frontmatter or the
container's connection and stamps `payload.provider`; the model never picks
a provider. Rename payload fields `issueKey`/`pageId` → `targetId`
(`domain/src/proposals/index.ts:108`), normalized for old rows in the
existing preprocess step; `findOutboundMirror` (`proposals.ts:658`) gains
provider disambiguation. Update together, same ticket: the shipped skill
copy (`sessions/src/defaults.ts`, 14 sites), the mirror-edit refusal text
(`tools.ts:1224`), SessionView's verb table (`SessionView.tsx:164`, keep
legacy names for old transcripts), MCP tool description
(`mcp-service.ts:170`), dev-seed fixtures, and telemetry words. Done when:
the vault-dev demo drafts a Jira comment end-to-end through the generic tool
under the fixture tests, and no shipped skill names a product in a tool name.

### Phase D: identity

**PD-10: Provider subfolder paths.**
`writeMirror` writes `tickets/<provider>/<external_id>.md` and
`wikipages/<provider>/<slug>.md` (`sync-service.ts:947`). One-time migration
on the first tick: move existing flat mirrors, update `sync_items.note_path`,
git-commit as one `sync: migrate mirror paths` commit. `itemByExternalId`
(`sync-store.ts`) gains a provider argument. Folder views and the ticket
board must treat `tickets/` recursively. Done when: a fresh sync and a
migrated vault produce the same tree, and the demo vault migrates cleanly
under `pnpm refresh-demo`.

**PD-11: Bare-key link resolution by lookup.**
`[[PAY-142]]` stops resolving via the regex path transform
(`renderer/lib/connections.ts:41-54`, plus `TICKET_KEY_RE` in
`sync-service.ts:52`): resolution becomes an index lookup by `external_id`
over mirror notes (the existing `connections:refMeta` path already carries
this data). The regex survives only as "might this be an external ref worth
tracking", not as an address. Ambiguity rule: if two providers own the same
key, the link renders as ambiguous and the harvest tracks neither silently.
Done when: the seven renderer call sites listed in the audit resolve through
the lookup and a fixture test covers the same-key-two-providers case.

**PD-13: Demo seed update.**
The canonical demo vault moves to the new shape: `vault-dev/tickets/*.md` →
`vault-dev/tickets/jira/`, `vault-dev/wikipages/*.md` →
`vault-dev/wikipages/confluence/`, and every `[[tickets/…]]` /
`[[wikipages/…]]` wikilink in vault-dev follows (customers, decisions, notes,
skills all carry them). `dev-seed.ts` proposal fixtures move to `targetId`
(`:147,:174`). `scripts/refresh-demo.ts` must copy the nested tree and its
date-shift must keep working. Done when: `pnpm refresh-demo` builds a clean
`.vault-dev/`, the index resolves the moved links, and the seeded inbox cards
render. Runs last, after PD-9 and PD-10 settle the shapes.

**PD-12: Copy sweep.**
Everywhere the UI asserts Jira/Confluence where it should name the note's
provider: `FolderView.tsx:62` empty states, `CardItem.tsx:576` evidence
chips (use `mirrorSource`), `RunnableConfig.tsx:32,54,56` permission rows,
`index-files.ts:41` index descriptions, `effect.ts:116` card effect lines,
`SettingsView.tsx:584` dry-run copy. Wording follows CLAUDE.md style. Pure
copy, safe anytime after PD-9 settles the tool names.

## Decisions

- **Local tickets: no.** Decided 2026-08-23. Tickets stay mirror-only. `todo`
  and `theme` are the local homes for work. Question 1 is closed.
- **Path scheme: provider subfolders.** Decided 2026-08-23:
  `tickets/linear/ENG-12.md`, `tickets/jira/PAY-142.md`, and the same for
  `wikipages/`. Two consequences to plan for:
  - Bare-key wikilinks (`[[PAY-142]]`) resolve today by a regex transform to
    `tickets/PAY-142` (`renderer/lib/connections.ts:54`). With subfolders the
    bare key is ambiguous on its face, so resolution becomes an index lookup
    (find the mirror whose `external_id` matches), not a string transform.
  - Existing vaults have flat `tickets/*.md`. Either the sync engine migrates
    them on first run after the change, or old mirrors are rebound via
    `sync_items.note_path` and only new mirrors land in subfolders. Migration
    is cleaner; the rebind machinery already exists.
- **Tool shape: generic write tools, no provider subagents.** Proposed
  2026-08-23, see "Who needs to know the provider" below.

## Who needs to know the provider

The question behind the tool shape: does the agent need to know an issue is in
Jira or Linear to comment on it, or to create one? Split it into three layers
and the answer is almost entirely no.

**Wire format: never the model's job.** The agent writes markdown. The
connector converts it (`markdownToAdf` in the Atlassian connector today;
Linear takes markdown natively). Formatting is deterministic code with tests,
not judgment. There is nothing for a "Jira formatting subagent" to be smart
about, and putting a model in that path would only add cost and variance to a
solved serialization problem.

**Addressing: data the system already has.** To comment or update, the agent
points at the mirror note. Its frontmatter carries `provider` and
`external_id`, so the tool handler stamps `payload.provider`; the model never
types "jira". To create, the agent picks a destination container (a Jira
project, a Linear team) from the followed-containers list. The provider
follows from the container. So the write tools become:

- `draft_ticket(container, title, body, kind?)`
- `draft_ticket_comment(ticket, body)` where `ticket` is the mirror ref
- `draft_page_update(page, …)`

replacing `draft_jira_issue` / `draft_jira_comment` /
`draft_confluence_update`. One tool set, any number of providers, and the
skill files stop naming products.

**Content: the only place the provider peeks through, and it is text.** Two
cases:

- Provider-specific fields (Jira wants `issueType`, Linear has labels). Keep
  the payload minimal, as it already is, and let each connector map the
  generic `kind` onto its own field. A field only one provider can honor is a
  connector concern, not a tool parameter.
- Team conventions ("our bug tickets carry Steps to reproduce"). That is an
  instruction, not machinery: a line in the owning skill or a voice file, which
  is exactly what the standing-instructions path exists for. Per-provider
  subagents would duplicate context, add a model hop, and hide where the
  convention lives.

**Reads are the honest exception.** Search speaks the provider's query
language (JQL vs Linear filters), so the query syntax IS the interface.
Keep per-provider read tools (`jira_search` stays; `linear_search` appears),
minted from the connector registry rather than hardcoded, so the SessionView
verb table and telemetry words derive from the same source.
