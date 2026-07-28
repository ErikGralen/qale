# Typed links — `[[type::target]]` and the unified edge model

> Design brief, written 2026-07-24. Status: **implemented 2026-07-24** (phases 1–3 below;
> phase 4 consumers remain future briefs). Decision (PO): adopt `[[type::target]]` inline
> syntax; a small predefined enum plus free-text types; typing is always optional and most
> human-written links are expected to stay untyped. See "Where the code lives" at the end.

## Why

Links in the vault serve three consumers: humans navigating, the tracking gesture
("linking is what makes an external item deep-tracked"), and — unlike Obsidian — **systems
that reason over the graph**: freshness/drift, commitment-check, the librarian, session
context assembly. For those systems an untyped edge only says "somehow related"; the
meaning has to be re-derived from prose every time. Typed edges make the graph computable:
"this decision rests on that evidence", "this commitment is blocked by that ticket".

Two observations make this cheap rather than speculative:

1. **We already have typed links.** `evidence`, `sources`, `supersedes`, `superseded_by`,
   `problem`, `customer`, `source_meeting`, `transcript` in frontmatter are typed, directed
   edges — the decision spine *is* a `supersedes` chain. The indexer even ingests them into
   the `links` table (`packages/vault/src/sqlite-index.ts`,
   `extractLinksFromFrontmatterAndBody`) — but **throws away which key the link came from**.
   The type column is information we currently drop on the floor.
2. **Jira's relationships are typed edges we currently ignore.** `issuelinks`
   (blocks/relates/duplicates) and epic `parent` are never fetched
   (`packages/atlassian/src/client.ts` requests only
   `summary,status,assignee,updated,description`). With an edge model they land naturally.

The classic argument against typed links — humans won't annotate, so the graph stays too
sparse to rely on — is weaker here because agents write half the content and type links for
free. The human path stays frictionless: plain `[[link]]` remains the default and is fine.

## The decision

- **One edge model.** Every relationship in the system normalizes to
  `(source, target, type, origin, position)` in the existing `links` table. Three origins
  feed it: **body** wikilinks (typed or not), **frontmatter** refs (the key is the type),
  and **synced** provider relationships (Jira issuelinks / epic parent).
- **Inline syntax `[[type::target]]`**, composing with the existing forms:
  `[[blocks::PAY-142]]`, `[[evidence::sources/gong-call#pricing|the Gong call]]`.
  Order inside the brackets: `type::target#anchor|alias`.
- **Hybrid vocabulary.** A small enum of types the system *understands* (renders with
  proper inverse labels, can drive behavior), plus free-text types that are legal,
  indexed, and display-only. Governance rule for the enum: **a type earns enum status only
  when some system behavior consumes it.** Everything else stays free-text until then.
- **Typing is optional, forever.** An untyped link is not a lint warning. Especially for
  human-written links, untyped is the expected common case.
- **Origin is the safety valve.** Only human/frontmatter/synced edges may ever drive hard
  behavior (staleness propagation, commitment-check verdicts). If we later add
  librarian-inferred soft edges, they suggest, never trigger.

## The type registry

New file `packages/domain/src/notes/link-types.ts`:

```ts
export interface LinkTypeDef {
  type: string;          // canonical token, lowercase-kebab
  forwardLabel: string;  // shown on the source note:  "blocks"
  inverseLabel: string;  // shown on the target note:  "blocked by"
}

export const LINK_TYPES: LinkTypeDef[] = [
  { type: 'supersedes',   forwardLabel: 'supersedes',  inverseLabel: 'superseded by' },
  { type: 'evidence',     forwardLabel: 'evidence',    inverseLabel: 'evidence for' },
  { type: 'source',       forwardLabel: 'source',      inverseLabel: 'source for' },
  { type: 'blocks',       forwardLabel: 'blocks',      inverseLabel: 'blocked by' },
  { type: 'part-of',      forwardLabel: 'part of',     inverseLabel: 'contains' },
  { type: 'about',        forwardLabel: 'about',       inverseLabel: 'mentioned in' },
  { type: 'relates',      forwardLabel: 'relates to',  inverseLabel: 'related to' },
  { type: 'duplicates',   forwardLabel: 'duplicates',  inverseLabel: 'duplicated by' },
];
```

Notes:

- **Direction instead of inverse pairs.** We store one edge and render both ends with the
  right label (Jira's inward/outward naming). `[[blocked-by::X]]` is *not* a separate enum
  member; the parser normalizes known inverse spellings (`blocked-by` → edge `X blocks me`).
  Keeps the graph canonical — queries never have to check both spellings.
- **Free-text types** normalize to lowercase-kebab (`waiting on` → `waiting-on`) and use
  the token itself as both labels. No error, no registry entry needed.
- **Frontmatter key → type mapping** stays boring and honest: the key is the type
  (`evidence` → `evidence`, `supersedes` → `supersedes`, `sources` → `source`,
  `source_meeting` → `source`, `customer`/`problem`/`transcript` → themselves).

## Syntax

```
[[target]]                      untyped (unchanged, the default)
[[target|alias]]                untyped with alias (unchanged)
[[blocks::PAY-142]]             typed
[[evidence::sources/call#pricing|the call]]   typed + anchor + alias
[[waiting on::people/asa-lindqvist]]          free-text type
```

Parsing rules, all implemented in ONE place — `normalizeLinkTarget`
(`packages/domain/src/notes/slug.ts:28`), which every consumer already shares:

- Split on the **first `::`**; the left side is the type token, normalized to
  lowercase-kebab. Slugs never contain `:`, so there is no ambiguity with targets.
- Known inverse spellings normalize to the canonical type + a `reversed` flag
  (`blocked-by::X` indexes as `X → blocks → me`).
- Empty type (`[[::x]]`) or empty target (`[[blocks::]]`) → treat the whole text as an
  untyped target, exactly like today's malformed-link behavior. Never hard-fail a parse.
- Return shape grows to `{ target, anchor, alias, linkType?, reversed? }`.

## How it changes existing code

Everything below the editor is mechanical because the codebase already funnels all link
handling through three chokepoints: `normalizeLinkTarget`, the remark plugin, and the
SQLite indexer.

### domain (`packages/domain`)

- `notes/slug.ts` — `normalizeLinkTarget` learns `type::` (above). **Every reconstruction
  site must re-emit the type** or repair/round-trip silently strips it:
  - `notes/link-repair.ts:167` `buildLinkRepairPatch` rebuilds links from parsed parts
    (`[[${newSlug}${anchor}${alias}]]`) — must include `${type}::`.
  - `notes/decisions.ts:20` `refToSlug` is unaffected (it only wants the slug) but now
    transparently accepts `[[supersedes::x]]` refs.
- New `notes/link-types.ts` — the registry (above).
- `notes/frontmatter.ts` — `zTicket` gains optional relationship fields written by sync:
  ```yaml
  parent: PAY-142            # epic key
  links:
    - { type: blocks, key: PAY-155 }
    - { type: relates, key: PAY-148 }
  ```

### markdown (`packages/markdown`)

- `wikilink.ts` — `WikiLinkData` gains `linkType?`; the remark plugin stamps
  `data-link-type` in `hProperties`; `collectWikiLinks` passes it through. The regex
  `\[\[([^\]]+)\]\]` is untouched — `::` is inside the existing capture.

### index (`packages/vault/src/sqlite-index.ts`)

- `links` table gains `type TEXT` and `origin TEXT NOT NULL DEFAULT 'body'`
  (`body | frontmatter | synced`). The index is fully rebuildable — bump
  `PRAGMA user_version` and `clear()` + full reindex on mismatch instead of writing an
  ALTER migration.
- `extractLinksFromFrontmatterAndBody` — the frontmatter loop stops discarding the key
  (it becomes `type`, origin `frontmatter`); body links carry their parsed `linkType`
  (origin `body`); ticket `parent`/`links` frontmatter becomes `part-of`/typed edges with
  origin `synced`. Ticket keys resolve as targets already (unique-basename resolution
  finds `tickets/PAY-142.md` from `PAY-142`).
- `backlinks()` returns `type`/`origin` per row and stops `GROUP BY source_path` collapsing
  — a note can legitimately be both `evidence` and `mentioned` from the same source; group
  in the DTO layer instead.

### application / ipc / dto

- `packages/application/src/ports.ts` — `LinkRecord` and `BacklinkRow` gain
  `type?`/`origin`.
- `apps/desktop/src/main/dto.ts` — `BacklinkDTO` gains `type?: string` plus resolved
  forward/inverse labels so the renderer never imports the registry logic.
- New handler surface (or extend the existing note-detail handler): **outbound typed
  edges** for the current note ("this note's relationships"), which the UI shows alongside
  backlinks. Today only backlinks are exposed.

### editor (`apps/desktop/src/renderer/src/components/editor/`)

- `wikilink.ts` (TipTap node) — `WikiLinkAttrs` gains `linkType`; `wikilinkAttrs` /
  `renderWikilink` round-trip it (the `raw` field already guarantees byte-exact
  serialization for untouched links). The node view renders the type as a small muted
  chip before the label — same pattern as the existing ticket state pill.
- `wikilink-suggest.ts` — the `[[` picker learns one thing: if the query contains `::`,
  the part before it is held as the type prefix and the part after is what searches;
  insertion re-attaches the prefix (`[[blocks::` + picked slug + `]]`). Optionally the
  menu's first row offers the enum types when the query is empty after `[[` — nice-to-have,
  not required. No new UI surface; typing stays one keystroke away from untyped.

### UI (`apps/desktop/src/renderer/src/app/`)

- `NoteView.tsx` — the flat "Linked from" list becomes **grouped by relationship**, inverse
  labels for inbound, forward labels for outbound synced/frontmatter edges:

  ```
  Blocked by (1)        ← inbound `blocks` edges
  Evidence for (2)      ← inbound `evidence` edges
  Linked from (7)       ← untyped, unchanged look
  ```

- Ticket notes get a **relationships row** rendered from `parent`/`links` frontmatter —
  "Part of [[PAY-142]] · Blocks [[PAY-155]]" as the same external-ref chips used in the
  editor (state pill included). `PropertiesBlock.tsx` adds `parent`/`links` to its ref
  rendering rather than growing a new component.

### agent (`packages/agent`)

- `prompts.ts:18` already instructs "cite notes as wikilinks". Add two sentences: the
  `[[type::target]]` form, when a relationship is load-bearing (blocks, evidence,
  part-of); explicitly say untyped is fine for plain mentions. No tool changes — agents
  write markdown, and the pipeline picks types up like any other link. Proposal cards,
  outbound drafts, and the MCP server all inherit this for free for the same reason.

### Jira sync (`packages/atlassian`, `packages/connectors`, sync-service)

- `client.ts` — add `issuelinks` and `parent` to the fields arrays (lines 170/195/212)
  and to the `JiraIssue` interface. Map per issue: `outwardIssue` + link type name →
  canonical type (`Blocks`→`blocks`, `Relates`→`relates`, `Duplicates`/`Cloners`→
  `duplicates`, unknown → free-text token); `inwardIssue` → same type, reversed.
  `parent` → `part-of`.
- `connector.ts` — `fetchFull` returns `{ parentKey?, links?: {type, key, reversed}[] }`;
  `sync-service.ts:423` writes them into the ticket frontmatter shown above. The indexer
  does the rest.
- **Change detection**: we rely on Jira bumping `updated` when links change (it does for
  link add/remove on both issues — verify against our site during implementation; if it
  ever misses, the existing periodic shallow sweep re-fetches anyway).
- Edges with origin `synced` are read-only in the vault: editing them locally is not a
  thing (change them in Jira; a future outbound card could propose it, out of scope here).

## What this unlocks (the consumers that justify the enum)

- **Grouped backlinks** — immediate, ships with the UI change.
- **Ticket hierarchy + blockers visible** — epic membership and blocking chains on ticket
  notes; commitment-check can walk `blocks` chains to say *why* a commitment is at risk.
- **Staleness that travels selectively** — future: `evidence`-edge targets changing flips
  the dependent decision to needs-review; a plain mention never taints anything. (Today
  no propagation code exists — `status: stale` is set by supersede handling and drift
  detection only. Typed edges are the prerequisite, not the feature.)
- **Traversal policy for context assembly** — sessions/librarian follow `evidence` and
  `part-of` deep, skip `about`/untyped. Cheaper, better context.
- **Librarian normalization** (future) — when a free-text type recurs, propose promotion/
  merge as a quiet maintenance ping, per the approval-queue IA.

## Demo data & scripts

- **`vault-dev/` (canonical, git-tracked)** — mirror what sync would have written:
  - `tickets/PAY-142.md` (SAML SSO epic): `links: [{type: blocks, reversed: true, key: PAY-161}]`
    style entries per the seeded structure; children `PAY-156`/`PAY-161` get
    `parent: PAY-142`. The PAY-142 comment already says "Audit-log export dependency split
    out as PAY-156" — the typed edge makes the existing story visible, which is the demo.
  - One or two **inline** typed links where the narrative supports it, e.g. the WorkOS
    decision note citing `[[evidence::sources/...]]`, and a note using a free-text type
    (`[[waiting on::people/...]]`) to demo the hybrid.
- **`scripts/reset-atlassian.ts`** — after `createIssue`, create real issue links via
  `POST /rest/api/3/issueLink` (e.g. "IdP metadata validation in staging" *blocks* the
  SAML SSO epic — consistent with the epic sitting in Blocked). Epic `parent` is already
  written at creation (line 492); now sync will actually read it back.
- **`scripts/refresh-demo.ts` / `pnpm refresh-demo`** — no changes needed: it date-shifts
  and copies; the runtime index is rebuilt from files, so typed links flow through. The
  index schema bump forces the rebuild on first launch anyway.
- **`demo-samples/`** — unaffected (drag-in transcripts, no wikilinks to type).

## Phasing

1. **Edge model** — parser + registry + index columns + frontmatter-key mapping + Jira
   issuelinks/parent sync. No new syntax visible yet; fixes "relationships dropped on the
   floor". Biggest bang, zero UI risk.
2. **Grouped backlinks + ticket relationships UI.** The edges become visible.
3. **Inline `[[type::target]]`** — editor node/suggest, agent prompt guidance, demo
   vault-dev examples.
4. **(Later, separate briefs)** staleness propagation along `evidence`, commitment-check
   `blocks`-chain walking, librarian free-text normalization.

Ship 1+2 together as one PR-sized change if convenient; 3 is independently revertible.

## Open questions

- Does Jira reliably bump `updated` on link changes on our site? (Verify in phase 1; the
  shallow sweep is the fallback.)
- Should `[[about::x]]` exist at all, or is untyped the same thing? Current stance:
  untyped ≈ `about`; keep `about` in the registry only as the inverse-label provider for
  untyped backlinks ("mentioned in") and don't encourage writing it.
- Multiple links same source→target with different types: allowed and indexed as separate
  rows (already decided above), but the backlink UI should dedupe within a group.

## Where the code lives (implemented 2026-07-24)

- **Registry + parser:** `packages/domain/src/notes/link-types.ts` (`LINK_TYPES`,
  `normalizeLinkType` canonicalizes inverse spellings → `{type, reversed}`,
  `linkTypeLabel`/`backlinkTypeLabel`/`linkTypeToken`); `slug.ts` `normalizeLinkTarget`
  parses `type::target#anchor|alias`, degrading malformed prefixes to untyped.
  `link-repair.ts` `buildLinkRepairPatch` re-emits the type on repointing.
- **Markdown:** `packages/markdown/src/wikilink.ts` — `WikiLinkData.linkType/reversed`,
  remark stamps `data-link-type` (display label) for the read view.
- **Index:** `packages/vault/src/sqlite-index.ts` — `links` gains `type`/`reversed`/
  `origin` (`body|frontmatter|synced`); `SCHEMA_VERSION` + `user_version` drop-and-rebuild
  migration; `FRONTMATTER_EDGE_KEYS` maps ref keys (`superseded_by` = `supersedes`
  reversed); ticket `parent`/`links` become synced edges; `backlinks()` returns one row
  per (source, relationship). Ports: `LinkRecord`/`BacklinkRow` in
  `packages/application/src/ports.ts`.
- **Jira sync:** `packages/atlassian/src/client.ts` fetches `parent`+`issuelinks`
  (`JiraIssueLink`); `packages/connectors/src/atlassian/connector.ts` `mapJiraLink` +
  `JIRA_LINK_TYPES`; `FullItem.parentKey/links` in `types.ts`;
  `apps/desktop/src/main/services/sync-service.ts` writes them into ticket frontmatter
  (`zTicket.parent/links` in `packages/domain/src/notes/frontmatter.ts`).
- **UI:** `NoteView.tsx` `groupBacklinks` (typed groups first, untyped last as "Linked
  from"); `BacklinkDTO.type/typeLabel` (label resolved main-side in `dto.ts`);
  `PropertiesBlock.tsx` `ticketRelationRows` ("Part of" / "Blocks" / "Blocked by" chips);
  `Markdown.tsx` `TypeChip` prefix in the read view.
- **Editor:** `components/editor/wikilink.ts` (attrs `linkType/reversed`, chip in the node
  view, byte-exact round-trip via `raw`); `wikilink-suggest.ts` `splitTypePrefix` — typing
  `[[blocks::pay` searches "pay" and re-attaches the prefix on insert.
- **Agent:** `packages/agent/src/prompts.ts` — type load-bearing links, plain `[[x]]` for
  mentions.
- **Demo:** `vault-dev/tickets/PAY-142/156/161` carry `parent`/`links`;
  `notes/rollout-runbook.md` shows `[[blocked-by::…]]`, a plain mention, and a free-text
  type; `scripts/reset-atlassian.ts` `CAST_LINKS` + `ensureIssueLink` seeds "PAY-161
  blocks PAY-142" idempotently; `scripts/refresh-demo.ts` strips type prefixes when
  validating links.
- **Tests:** `packages/domain/test/link-types.test.ts`, typed cases in
  `link-repair.test.ts`, `packages/markdown/test/pipeline.test.ts`,
  `apps/desktop/test/wikilink.test.ts`, and the typed-edges case in
  `packages/vault/test/sqlite-index.test.ts` (run under the Electron ABI:
  `ELECTRON_RUN_AS_NODE=1 …/Electron …/tsx --test test/sqlite-index.test.ts`).

**Verified against the live demo site (2026-07-24):** the seeded link reads correctly
from both ends (PAY-1 "is blocked by PAY-3", PAY-3 "blocks PAY-1", PAY-3 `parent` →
PAY-1) — so the POST `/issueLink` direction (inwardIssue = the blocker) and the client's
GET mapping (`outwardIssue` present = outward description applies, `reversed: false`) are
both right. Creating the link bumped `updated` on BOTH issues, so incremental sync
notices link changes without any special-casing.

---

## Authoring a relationship by hand (built 2026-07-28)

The phase-3 editor work above shipped the *parsing* half only: `[[blocks::pay` worked, but
nothing said so and nothing could retype a link that already existed (the pill is an atom;
clicking it navigates). Both gaps are now closed, with one new decision:

**The vocabulary offered is filtered by what the link points at.** `linkTypeOptions(targetType)`
(`packages/domain/src/notes/link-types.ts`) reads a new `LinkTypeDef.targets` — the note
types a relationship makes sense *against*. A person link offers "source / source for /
about / relates to" and never "supersedes" or "blocked by"; a ticket link is where the
blocking vocabulary lives. `about`/`relates` deliberately carry no `targets`, so the list
is never empty. This is an **offer list, not a rule** — any type on any target still
parses, indexes and renders exactly as before, which keeps agents and hand-typed markdown
unconstrained.

Two more sub-decisions:

- **Direction is a row, not a mode.** Asymmetric types offer both readings ("blocks" /
  "blocked by") and write the matching token; `noInverse` suppresses the inverse row where
  it isn't a real authoring choice (`relates`, and `about` → "mentioned in", which is a
  backlink reading per the open question above).
- **No new enum members for people.** The obvious gaps (`owner`, `waiting on`) stay
  free-text — the governance rule is that a type earns enum status when behavior consumes
  it, and nothing consumes those yet. The picker's filter box doubles as free-text entry
  instead, so `waiting on::` is one line of typing away and still indexes.

### The two gestures

1. **`[[` picker, ⇧↵** — ↵ still inserts an untyped link (the common case, unchanged).
   ⇧↵ inserts it *and* opens the relationship menu, which is the only ordering that lets
   the offer list be filtered: the target has to be known first. A footer hint in the menu
   states both. Typing `blocks::` by hand still works and now shows the held relationship
   as a header chip above the results.
2. **The pill's chevron** — a hover affordance inside the link node (`data-link-type-button`)
   selects the node and opens the same menu, so an existing link — including one an agent
   wrote — can be typed, retyped, or cleared. It needed its own hit target because a plain
   click has to keep navigating.

Both routes converge on one path: select the wikiLink node → fire `EDIT_LINK_TYPE_EVENT`
on the editor DOM → `SelectionToolbar` (which already owns the floating bar over a
selection) renders `LinkTypeMenu`. A selected wikilink also gets its own bar — relationship
+ "Remove link" — since an atom has no text to mark up.

### Where the code lives

- `packages/domain/src/notes/link-types.ts` — `LinkTypeDef.targets/noInverse`,
  `LinkTypeOption`, `linkTypeOptions(targetType)`.
- `apps/desktop/src/renderer/src/components/editor/link-type.ts` — `targetNoteType`
  (folder ⇒ note type; bare ticket keys normalize first), the event name.
- `.../editor/LinkTypeMenu.tsx` — the filtered listbox + free-text entry + "No relationship".
- `.../editor/wikilink.ts` — `retypeWikilink` (rebuilds `raw` from the parts, so the file
  round-trips), the chevron in the node view.
- `.../editor/SelectionToolbar.tsx` — wikilink NodeSelection mode, apply/unlink.
- `.../editor/wikilink-suggest.ts` + `suggestion-render.tsx`/`SuggestionMenu.tsx` — ⇧↵
  (`shiftSelect`), header/footer chrome.
- Tests: `linkTypeOptions` filtering in `packages/domain/test/link-types.test.ts`;
  `retypeWikilink`/`targetNoteType`/`splitTypePrefix` in `apps/desktop/test/wikilink.test.ts`.
