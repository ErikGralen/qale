# PLAN V2 — from the prototype to Produktminnet

*2026-07-14 · Supersedes [PLAN.md](PLAN.md) (the three-loops prototype, built through Phase 6).
Target: [docs/PRODUCT-CONCEPT.md](docs/PRODUCT-CONCEPT.md), constrained by
[docs/takeaways-combined.md](docs/takeaways-combined.md) /
[-design](docs/takeaways-design.md) / [-sources](docs/takeaways-sources.md).*

**Invariants (not up for debate):** pi.dev as the agent runtime, shadcn (+ AI Elements) for UI,
the DDD/clean-architecture Turborepo. Everything else may be scrapped.

---

## 1. The gap in one table

The prototype validated the *mechanics* (typed markdown vault, propose-only agent, cite-or-decline
enforced in tools, review queue, FTS index, Atlassian read). The concept changes the *product*:

| Dimension | Built today (PLAN.md) | Concept (PRODUCT-CONCEPT.md) |
|---|---|---|
| Center of gravity | 3 loops: signal triage · transcript ingest · ask | **After-Meeting session** → truth delta → approval cards → Jira/Confluence drafts |
| Object model | signal / theme / transcript / meeting-summary / decision / action / open-question / note | meeting · **decision (supersedes-chains)** · insight (confidence + freshness) · customer · problem (hub) · release · person · session · skill — OKF-conformant |
| Sessions | 4 hardcoded types in `packages/agent/src/prompts.ts`; one chat view | Persistent typed sessions **as tabs**, defined as **markdown skill files in `skills/`** (When/Read/Produce/Then), checkpointed, guardrailed, dry-runnable |
| Home | Landing page + review stepper view | **Inbox** of approval cards, pinned top-left, reachable zero |
| Navigation | Sidebar groups per note type (inventory) | Hubs + **smart views** (saved frontmatter queries) + ⌘K search-first + authored `index.md` per folder |
| Writes outward | None (Atlassian read-only) | Jira/Confluence/outbound **drafts through approval cards, forever**; per-audience voice guides |
| Trust tiers | Suggest-only (proposals) | Observe / Suggest / **earned Auto-apply** / Outbound-always-draft; safe-space mode; accept-rate telemetry |
| Freshness | Evidence count + newest date on themes | First-class: type-appropriate decay clocks, nightly sweep, document health |
| Ambient work | None | Scheduled sessions (Weekly Update), overnight prep, Monday brief |
| Interop | — | **Workspace as MCP server** (`ask_product`, `log_decision`, `draft_writeback`) |

Sequencing authority stays the MVP decision: **MVP1 = After-Meeting**, single-player, kill criteria
= approval rate <40% or time-to-approve >24h by week 4. Every phase below is ordered to get
After-Meeting excellent first; Sprint Review / Spec Review / Interview Synthesis are content
(skill files), not code, once the engine exists.

---

## 2. Keep / refactor / scrap — the honest inventory

### Keep as-is (the chassis is right)

- **Monorepo + dependency rule** — `domain ← application ← {vault, agent, atlassian} ← main`;
  JIT packages; typed IPC with per-channel preload functions. Untouched.
- **pi embedding discipline** (`packages/agent/src/runtime.ts`): full-control mode, zero built-in
  tools, realpath containment, own AuthStorage/SessionManager/ResourceLoader. This *is* the
  concept's "enforced in the write path, not by prompt".
- **`propose_*` validation** (`packages/domain/src/proposals`, `packages/agent/src/tools.ts`):
  cite-or-decline with `inference: true` escape hatch — exactly the concept's rule. Extend, don't rewrite.
- **Proposal store + `base_hash` staleness** (`packages/vault/src/proposal-store.ts`) — becomes the
  approval-card store.
- **pi→UIMessageChunk bridge** (`packages/agent/src/bridge.ts`), IPC streaming, abort path.
- **Vault infra**: `FsVault` containment, `SqliteIndex` (files/links/FTS5), chokidar watcher with
  debounced queue, `GitAdapter` path-scoped commits, rebuildable-index discipline.
- **Atlassian client** (`packages/atlassian`): search/get endpoints, ADF→md, 429/401 handling —
  extended with write endpoints in Phase 5.
- **shadcn + AI Elements vendored set** in `packages/ui`; warm-clay identity; theme provider.

### Refactor (right idea, wrong shape)

- **Domain schemas** (`packages/domain/src/notes/frontmatter.ts`): the zod-per-type +
  `z.infer` + layer-rules pattern stays; the *type set* is replaced (§3.1). Signals→insights,
  themes→problems, transcripts fold into `meetings/`; add customer/person/release/session/skill.
- **Review queue → Inbox.** `ReviewView.tsx`'s stepper interaction (group as accept-unit, skip,
  undo, receipt) survives as the *card batch* interaction inside the new Inbox. The single-view
  `CenterView` union it lives in does not (§3.3).
- **Session registry** (`prompts.ts`): the registry pattern stays, but session definitions move
  from TS constants to **markdown skill files in the workspace** parsed at session start; TS keeps
  only the harness (checkpointing, guardrails, tool allowlists per tier).
- **Sidebar** (`Sidebar.tsx`): tree code reusable, but reorganized: Inbox pinned on top, smart
  views above the tree, hubs-not-inventory, meetings collapsed by month.
- **App state** (`app-state.tsx`): grows from single `CenterView` to a **tab model** (ordered tabs,
  each doc-or-session, persisted). Context approach is fine at this scale; revisit only if it hurts.

### Scrap (deliberate, with reasons)

- **Loop 1 signal triage as a product surface** (`triage` session type, ThemesView, standalone
  signal capture flow). The concept has no standalone triage loop — insights arrive as part of
  After-Meeting / Interview Synthesis truth deltas. The stepper *interaction* is recycled (above);
  the signals/themes *model* is not. ⌘N quick capture is repointed at the 60-second debrief.
- **`themes/`, `signals/`, `actions/`, `questions/` as folders.** Actions live in the truth delta
  and (post-approval) in Jira — we hold the why, Jira holds the what (tracker seam). Open questions
  become sections on problem/meeting pages plus frontmatter (queryable via smart views), not a folder.
- **IngestView as a separate view** — transcript drop becomes the entry point of an After-Meeting
  session, not a destination.
- **Old demo fixtures + demo script** — rewritten around one After-Meeting narrative.
- **Existing vault scaffolds/data** — prototype-only; no migration burden. A one-shot
  `scripts/migrate-vault.ts` (signals→insights, themes→problems) only if we care about our own
  dogfood vault; otherwise re-seed.

---

## 3. Target architecture (deltas only)

### 3.1 Workspace model (replaces vault §3.5 of PLAN.md)

OKF-conformant: `type` required in frontmatter, per-folder schema, generated `index.md` per folder,
`# Citations` convention, consumers tolerate unknown types.

```
workspace/
├── meetings/       # immutable transcript + its approved truth delta (raw + derived in one hub page pair)
├── decisions/      # THE SPINE: what/why/who/when · status: active|superseded · supersedes/superseded_by
├── insights/       # claims: evidence[] · confidence: high|med|low · freshness policy + last_verified
├── customers/      # hub: commitments · signals · what-they-were-told ledger
├── problems/       # durable problem/epic hubs (absorbs themes; keeps stance vocabulary)
├── releases/       # what shipped · notes per audience
├── people/         # stakeholders: cares-about · last_told
├── sessions/       # replayable session transcripts — the audit trail (derived, written by the harness)
└── skills/         # session types · voice guides · _filing-rules.md — content, versioned, forkable
```

Domain rules to encode in `packages/domain`:

- **Decisions are append-only**: superseding creates a new file + back-pointer; `status` flips —
  never edit the old decision's body. Enforced in the application layer like the raw invariant is today.
- **Freshness is a schema concern**: every insight/claim type declares a decay clock
  (`fresh_for: 90d` style, per-type default, per-file override); `last_verified` set on approval.
  Health = share of live claims still fresh — computed in domain, surfaced everywhere.
- **Truth delta** is a first-class domain object (decisions[] · actions+owners[] · open_questions[] ·
  not_doings[] · who_needs_to_know[]) — the typed payload of an After-Meeting session, each item
  becoming one approval card.
- Frontmatter is never hand-written: the properties panel renders it as a form (per-folder zod schema
  → form fields — same pattern OpenKnowledge uses with `.ok/frontmatter.yml`).

### 3.2 Session engine (the biggest new build)

A session = a persistent pi session + a **skill file** + a **harness state machine**.

- **Skill file** (`skills/after-meeting.md`): plain-English When/Read/Produce/Then sections +
  structured frontmatter (tool tier, checkpoints, stopping conditions, red flags, completion bar).
  Parsed → system prompt + tool allowlist + checkpoint plan. Editing the file *is* configuring the
  product. Ship ~6 defaults as content.
- **Harness** (new `packages/sessions`, application-layer): drives checkpoints (one round at a
  time; outline → confirm → draft), enforces completion bars before `propose_*` is allowed,
  records a reads/writes receipt, and files the transcript to `sessions/` on close.
- **Sessions are tabs**: session id ↔ tab; pi JSONL (already per-session in userData) is the resume
  store; the filed markdown transcript in `sessions/` is the human-auditable copy.
- **Tool tiers map to the trust model**: observe-tools (read/search — always), suggest-tools
  (`propose_*` — default), outbound-tools (`draft_jira_issue`, `draft_confluence_update`,
  `draft_message` — produce cards only, forever). Auto-apply is a *card-application policy* per
  session type (earned, revocable, internal writes only), not a tool the agent holds.

### 3.3 UI shell (OpenKnowledge geometry)

- **Tabs** hold documents and sessions interchangeably; persisted across restarts; ⌘K opens either.
- **Left panel**: 📥 Inbox (pending-card count) pinned → smart views (saved frontmatter queries:
  Needs review · Stale · This week · by-customer) → hub tree (customers/problems/decisions…,
  meetings collapsed by month) → ⚙ Skills.
- **Center**: document read view (react-markdown, wikilinks, backlinks footer) *or* session chat
  (AI Elements) — same tab strip.
- **Right panel**: per-document scoped side chat (an `ask`-tier session scoped to the doc +
  @-mentions) *or* properties form (frontmatter-as-form). Selection → contextual verbs
  (Verify · Find evidence · Rewrite for audience · Turn into ticket · Ask) = pre-filled side-chat prompts.
- **Folder pages**: generated `index.md` + listing + docked Ask composer scoped to the folder.
- **Approval card anatomy** (one component, all card kinds): diff-at-review-time + one-line
  *because* + receipts (evidence chips) + inference badge; approve / edit-then-approve / discard;
  batch accept with spot-audit prompts after long streaks.

### 3.4 Outbound (new)

- Atlassian client grows writes: create issue, add comment, update page — invoked **only** by the
  card-application layer on approval, never by an agent tool directly.
- Every outbound card stores the exact payload; links rendered from API responses only
  (deterministic-links rule — the model never composes a URL).
- Voice guides (`skills/voice-*.md`): per-audience style + banned phrases, injected when a session
  produces outbound drafts; changed by editing the file, not by drift.
- Slack/Teams/email: out of scope until MVP2 (Svarsutkastaren); the card model is already shaped for it.

### 3.5 Ambient + MCP (later phases, design now)

- **Scheduler** in main process (app-open cron): scheduled sessions (Weekly Update Fri 15:00),
  nightly freshness sweep, contradiction check — all landing as Inbox cards, never applied. Every
  scheduled session ships with **dry-run** ("what would this have produced last week") before enabling.
- **MCP server**: main process hosts a local MCP server (stdio child + streamable-HTTP on
  localhost) exposing `ask_product`, `log_decision`, `draft_writeback` — all three route through
  the same use cases and approval cards as the in-app agent. pi (no MCP client, by design) is
  unaffected; this is us being a *server* for the customer's Claude.

---

## 4. Phases

Each phase ends runnable (`turbo dev --filter=desktop`) and demoable. Instrument
accept/reject/edit + time-to-approve from Phase 3 on — that's the kill-criteria metric and the
future eval set.

### Phase 1 — Workspace remodel (domain first)

1. `packages/domain`: new type set (§3.1) — meeting, decision (+supersedes), insight, customer,
   problem, release, person, session-transcript, skill; freshness fields + health computation;
   truth-delta object; retire signal/theme/action/question schemas.
2. Layer rules updated: meetings-transcript-part immutable; decisions append-only-supersede;
   sessions/ derived-by-harness.
3. `packages/vault`: scaffold generator for the new layout; per-folder schema surfaced to the
   properties form; generated `index.md` per folder (agent-refreshable, deterministic skeleton);
   OKF conventions (`log.md` optional, `# Citations`).
4. `packages/ipc` + handlers: tree/type DTOs updated. Renderer compiles against new types with the
   *old* shell (temporarily ugly is fine).
5. New demo fixture narrative: one customer (acme-co), one problem, 6 decisions with one
   supersedes-chain, 2 meetings with transcripts, insights with mixed freshness.

**Done when:** new workspace scaffolds, indexes, searches; decision supersedes-chain renders as a
chain; a stale insight is computably stale; old folders/types are gone from the codebase.

### Phase 2 — Shell: tabs, Inbox, smart views, properties

1. Tab model in app state (persisted list of doc/session tabs) + tab strip UI; ⌘K opens into tabs.
2. Left panel v2: Inbox pinned (badge = pending cards), smart views (frontmatter queries over the
   files table — `type:` + status + freshness predicates; 4 built-ins, user-savable later), hub
   tree, Skills section listing `skills/`.
3. Inbox view: unified card list (replaces ReviewView route; recycles its stepper mechanics for
   grouped cards); reachable zero state.
4. Right panel v2: properties form (zod schema → fields, writes frontmatter through the save use
   case) ⇄ doc-scoped side chat toggle.
5. Folder pages with listing + docked scoped Ask composer.

**Done when:** an After-Meeting-shaped fake session tab sits next to the customer page it cites;
restart restores tabs; Inbox reaches zero; frontmatter is edited only via the form.

### Phase 3 — Session engine + After-Meeting ⭐ (the MVP1 core)

1. `packages/sessions`: skill-file parser (When/Read/Produce/Then + guardrail frontmatter) →
   session config; checkpoint state machine; completion-bar gate before propose-tools unlock;
   reads/writes receipt; transcript filed to `sessions/` on close.
2. Ship `skills/after-meeting.md` + `skills/_filing-rules.md` as authored defaults.
3. After-Meeting flow: transcript drop **or 60-second debrief** (⌘N: text now, voice-note file
   parked) → session reads transcript + related memory (customer page, problem, prior decisions via
   search) → checkpointed synthesis → **truth delta** → one approval card per item
   (`propose_decision`, `propose_insight`, `propose_update`, `propose_meeting_summary` — all
   through the existing validation path).
4. Card application: accepted cards write files + path-scoped commit + set `last_verified`;
   who-needs-to-know items update `people/*.last_told` ledgers.
5. Telemetry: per-card accept/reject/edit-distance + time-to-approve into app.db.

**Done when:** fixture transcript in → ~8–12 cards out, judged in seconds each → memory visibly
grows (decision log entry, insight, customer page delta, meeting hub page) → session transcript
replayable from `sessions/`. Approval rate + time-to-approve queryable.

### Phase 4 — Ask + golden answers (upgrade, not new)

1. `ask` session type becomes a skill file; honest-absence + honest-confidence prompts carry over;
   citations still rendered from actual tool results only.
2. Scoped ask everywhere: global ⌘⏎, folder composer, doc side chat — same engine, different read scope.
3. **Save as golden answer**: approved answer → `insights/` (or customer page section) with sources
   + date, via a normal card.
4. Freshness surfaces in answers ("2 insights, both from one account, newest 40 days old").

**Done when:** "why did we drop the X integration?" answers with the superseded-decision chain +
dates, or says "vet inte"; a saved golden answer is findable and cited by the next ask.

### Phase 5 — Outbound: Jira/Confluence drafts

1. `packages/atlassian` writes: create issue (ADF composition), add comment, update page section;
   payload preview rendered in the card; deterministic links from responses.
2. Outbound card kind (tier: outbound — no auto-apply path, ever); truth-delta actions produce Jira
   draft cards; meeting summaries produce Confluence row/comment drafts.
3. Voice guides (`skills/voice-*.md`) applied to outbound composition; per-audience note drafts
   (CS/sales/exec) from who-needs-to-know.
4. Safe-space mode: per-meeting flag at ingest → capture off, nothing formalized, transcript not retained.

**Done when:** approve a card → real issue exists in the sandbox Jira with a working deep link back;
nothing reaches Jira without a card; a safe-space meeting leaves no trace.

### Phase 6 — The librarian: freshness sweeps + maintenance

1. Nightly (app-open) sweep: decay clocks → stale flags → "needs re-verification" cards in Inbox;
   document health scores on hubs and in smart views.
2. Contradiction detection pass (new insight vs existing claims — flag, never resolve silently).
3. Filing rules (`skills/_filing-rules.md`) drive `propose_note` target paths; link repair + orphan
   adoption as maintenance cards; folder `index.md` refresh.
4. Anti-rubber-stamping: spot-audit prompt after N consecutive batch-accepts; accept-rate per
   session type in settings.

**Done when:** age the fixture clock → Inbox shows stale-claim cards; a contradicting insight flags
its target; the workspace stays navigable without hand-tidying.

### Phase 7 — Scheduled sessions + Weekly Update

1. Main-process scheduler (while app runs; catch-up on launch for missed slots).
2. `skills/weekly-update.md`: reads the week's deltas across memory (+ Jira), produces per-audience
   update drafts, every claim cited — held in Inbox.
3. **Dry-run before enabling**: run against last week's real data, show the counterfactual output.
4. Earned auto-apply: per session type, offered by the product on track record
   ("accepted 47 of 49 — auto-apply internally with a change log?"), internal writes only, revocable,
   change-log card posted after each auto-application.

**Done when:** Friday 15:00 (or simulated) lands a cited weekly update draft in the Inbox; dry-run
works on a fresh skill; auto-apply can be earned, observed via change log, and revoked.

### Phase 8 — MCP server + remaining session packs

1. MCP server (localhost) exposing `ask_product` / `log_decision` / `draft_writeback` → same use
   cases, same cards; token-gated; docs for pointing Claude/Cursor at it.
2. Sprint Review, Interview Synthesis, Spec Review as skill files (content sprint, not code —
   the engine test: zero TS changes required to ship them).
3. Package + polish: electron-builder run, packaged-app smoke test with the new demo script,
   session receipts, empty states, keyboard pass.

**Done when:** an external Claude asks the workspace a question and files a draft that appears as a
card; three new session types shipped without touching `packages/sessions`.

---

## 5. Risks (new ones — PLAN.md §6 gotchas still apply)

1. **Review fatigue is still the death mode.** Cards must stay cluster-grouped, digest-cadenced,
   auto-expiring; watch queue depth and time-to-clear from Phase 3, not after. Kill criteria are live.
2. **Skill-file expressiveness creep.** When/Read/Produce/Then must stay a sentence, not a DSL.
   Anything the grammar can't say goes in the TS harness, not in ever-richer frontmatter.
3. **Tabs + persistent sessions across restarts**: pi JSONL resume is per-session — verify resume
   fidelity (tool results, checkpoint position) early in Phase 3; fallback = reopen transcript
   read-only with a "continue in new session" affordance.
4. **Jira writes are a different trust class than reads**: scoped-token/permission failures at
   *apply* time must fail the card gracefully (card returns to Inbox with the error, nothing
   half-applied). Idempotency keys on card application.
5. **Scheduler in a desktop app** only runs while the app runs — catch-up-on-launch is the honest
   v1; don't promise "overnight" until there's a headless story.
6. **Decision supersedes-chains** need cycle/lineage guards in domain from day one — repairing a
   corrupted chain later is archaeology.
7. **Scope magnet: building OpenKnowledge.** The non-goal test from the concept applies to every PR:
   if a feature neither reads from nor writes to the typed objects, it doesn't ship. No WYSIWYG,
   no generic editor — Obsidian/any editor remains the raw-file editor.

## 6. Open decisions (fine to defer, tracked here)

- **Voice debrief capture** (Phase 3 ships typed debrief; voice = file-drop of an audio transcript
  from the OS recorder first, never our own recording — non-negotiable from the concept).
- **How much Jira state to mirror** into memory vs link out (start: link-only + read-at-answer-time;
  revisit if answer latency hurts).
- **Smart-view query language**: start with structured filters over the files table; no user-facing
  query syntax until someone asks.
- **Scenario branches** (git branches of the brain): parked until a pilot asks, per the concept.
- **Name** stays Produktminnet-as-placeholder; `workspace/` is the neutral term in code.
