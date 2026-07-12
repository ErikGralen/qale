# PM Workspace OS — Implementation Plan

*Working prototype plan · 2026-07-12 · versions verified against live docs/npm on this date;
plan reviewed adversarially against the research (technical / architecture / product lenses)*

## 1. What we're building

A local-first **workspace OS for product managers**: an Electron desktop app whose core is a
**product brain** — an Obsidian-style vault of plain markdown files with `[[wikilinks]]` and YAML
frontmatter — operated on by an embedded AI agent (pi.dev). The agent **proposes, the PM disposes**:
every AI write arrives as a reviewable proposal with evidence links; nothing mutates the vault or
leaves the app without the PM's accept.

The prototype focuses on three loops (in build order):

1. **Signals in → triage flow.** Capture signals (paste, quick capture; connectors later), agent
   proposes theme links / new themes at the *cluster* level, PM triages in a stepper UI, accepted
   links accrue as evidence in the vault.
2. **Meeting transcripts → recommended actions & updates.** Drop in a transcript; the agent extracts
   signals, decisions, action items, and proposed *updates to existing notes* — all as proposals in
   a review queue.
3. **Find anything across tools.** Ask a question; the agent searches the vault (FTS + embeddings
   later) *and* Jira/Confluence, and answers with citations that deep-link to the source.

Every loop deposits durable, cited markdown into the vault — that's how the product brain compounds.

### Design principles (from the concept docs + qale)

- **Sessions are verbs, notes are nouns.** Sessions never store knowledge; notes never do work.
  Every session declares what it read and what it produced (the reads/writes contract → audit log).
- **Three note layers** drive permissions: **raw** (signals, transcripts), **derived** (AI
  syntheses — always cite sources, regenerable), **authored** (human-owned, possibly AI-drafted).
  The raw invariant, precisely: *bodies and provenance fields (`source`, `captured`) are immutable;
  designated workflow frontmatter fields (`status`) are mutable only through application-layer use
  cases triggered by human-accepted proposals.* Theme membership is written on the **theme's**
  evidence list, never on the signal (qale's invariant) — a signal's themes are derived from
  backlinks.
- **Provenance on everything — enforced at the tool layer, not by prompt.** `propose_*` tool
  handlers *reject* proposals whose `sources[]` is empty or whose wikilink/URL targets don't
  resolve against the index, unless explicitly flagged `inference: true` (rendered visually
  distinct). Ask-answers render citations from the session's *actual tool-call results*;
  model-emitted links that don't match a tool result render as inference.
- **The tracker seam.** Jira stays the system of execution. We hold the *why* and point at the
  *what* — read-only references, never a second stale ticket store.
- **Proposals are the only write path for agents.** The agent has no write/edit/bash tools at all;
  its `propose_*` tools persist proposal rows, and only the review layer applies them.
- **Obsidian-compatible.** The vault must open cleanly in Obsidian: CommonMark + GFM,
  `[[wikilinks]]` (incl. aliases), YAML frontmatter. We never rewrite bytes we didn't touch —
  for the prototype, *Obsidian (or any editor) is the vault editor*; the app is the brain's UI.

### What we carry over from qale (and what we fix)

Carry over: the raw/derived/authored layers; session reads/writes contract; **theme stances**
(exploring / watching / committed / wont-do, with evidence accruing even on wont-do); the **triage
stepper** interaction (grouping "same thing?", multi-theme linking, prefilled new-theme dialog,
skip vs discard, undo, end-of-queue receipt); the tracker seam discipline; mandatory one-line
`summary` as the token-cheap retrieval index; open questions as first-class; the Now/Streams/Library
navigation and ⌘K switcher; the warm clay oklch visual identity (Inter + Fraunces).

Fix: the fat `Note` interface → **discriminated unions via zod frontmatter schemas**; TipTap HTML
bodies with `<span data-id>` links → **plain markdown + `[[wikilinks]]`**; unpersisted sessions →
**pi JSONL sessions as the store**; no real ingestion/search → this prototype's whole point.

---

## 2. Verified stack (as of 2026-07-12)

| Piece | Choice | Version | Key facts found in research |
|---|---|---|---|
| Runtime | Electron | **^43.1.0** | Chromium 150, Node 24.18, ABI 148. ESM main ✓, sandboxed preload = CJS |
| Build | electron-vite | **^5.0.0** | One config for main/preload/renderer. **Peer-pins Vite ^5‖^6‖^7 → pin `vite@^7`, NOT 8** |
| Packaging | electron-builder | **^26.15.3** | Prototype: `--dir` (unpacked, unsigned) |
| Monorepo | turbo | **^2.10.4** | v2 `tasks` key (not `pipeline`), `ui: "tui"`, JIT internal packages. Docs now at turborepo.dev |
| Pkg manager | pnpm | **11.12.0** | Must allowlist postinstalls: `onlyBuiltDependencies: [electron, better-sqlite3, esbuild]` |
| Agent runtime | @earendil-works/pi-coding-agent | **0.80.6** | ⚠️ `@mariozechner/*` is deprecated — pi moved to Earendil (github.com/earendil-works/pi). Node ≥22.19. No MCP by design. Tool schemas = TypeBox (`typebox@1.1.38`). Pin exact; bump all pi pkgs together |
| LLM providers | @earendil-works/pi-ai | **0.80.6** | `getModel('anthropic', …)`; keys via `authStorage.setRuntimeApiKey` (in-memory, never on disk) |
| Chat data layer | ai (AI SDK) | **^7.0.22** | v7 GA June 2026. `ChatTransport` interface → custom IPC transport. `createUIMessageStream` bridges pi events |
| Chat hooks | @ai-sdk/react | **^4.0.23** | Pairs with ai v7 (3.x pairs with v6 — don't mix) |
| Chat UI | AI Elements | CLI **1.9.0** | 48 shadcn-registry components, vendored source. **No Next.js required** (verified: zero `next/*` imports). React 19 hard floor. Markdown via Streamdown 2.5.0 |
| Components | shadcn CLI | **4.13.0** | Styles are now `{library}-{style}` (18 values). **Base UI became the default lib July 2026**; Radix fully supported via unified `radix-ui@1.6.2`. We use **`radix-nova`** (qale continuity; AI Elements built against Radix-era shadcn). `init --monorepo` scaffolds apps + packages/ui. Note: shadcn also shipped its own chat components June 2026 (`message-scroller`, `bubble` …) — evaluate overlap with AI Elements when wiring chat |
| CSS | tailwindcss | **^4.3.2** | CSS-first config, oklch CSS variables, `@theme inline`. **Needs `@source` globs for workspace pkgs** |
| React | react | **^19.2** | Required by AI Elements |
| TypeScript | typescript | **~5.9** | TS 7 (native compiler) is npm latest but tooling risk — conservative pin for now |
| Schema validation | zod | latest 4.x | Frontmatter schemas; the one dependency allowed in `packages/domain` |
| MD parsing | unified + remark-parse | 11.x / 11.x | + `remark-frontmatter@5`, `remark-gfm@4`, `yaml@2.9` (skip dormant gray-matter) |
| Wikilinks | @flowershow/remark-wiki-link | **4.0.0** | June 2026; Obsidian aliases/embeds/heading links/shortest-path resolution. (Original remark-wiki-link is stale) |
| Watching | chokidar | **^5.0.0** | ESM-only, named exports, no globs (filter `.md` yourself), no native deps |
| Index/search | better-sqlite3 | **^12.11.1** | FTS5. Prebuilds cover Electron ABI 148 → no rebuild pain today. WAL mode + busy_timeout on all connections |
| Vector search | sqlite-vec | **0.1.9** | Phase 5 stretch. Brute-force KNN (fine <100k chunks). Per-platform optional deps; needs its own `asarUnpack` glob (not covered by `**/*.node`) |
| Git layer | simple-git | latest | Thin wrapper over system git + startup availability check (fallback message if absent). Path-scoped commits only — see §3.5 |
| Read view | react-markdown | **10.1.0** | Same remark plugin array as the indexer — shared from one package |
| Jira | REST v3, API token | — | ⚠️ `/rest/api/3/search` is **removed**; use `POST /rest/api/3/search/jql` (nextPageToken pagination, must pass `fields`). Descriptions are ADF JSON → markdown converter needed |
| Confluence | REST v1 search + v2 pages | — | CQL search only exists on v1 `/wiki/rest/api/search` (officially not deprecated); page bodies via v2 `/wiki/api/v2/pages/{id}`. Storage format = XHTML → turndown |
| Secrets | Electron safeStorage | — | Anthropic key + Atlassian email/token, main process only |

Deliberately **not** used in v1: Electron Forge (Vite plugin still experimental, pnpm-workspace
issue #4188); MCP for Atlassian (pi has no MCP; plain REST tools are cheaper and more deterministic
— the official Rovo MCP server at mcp.atlassian.com stays as a documented fallback); TipTap or any
WYSIWYG as vault editor (round-trips normalize markdown — breaks Obsidian/git diffs); an in-app
CodeMirror vault editor (deferred — see §7; Obsidian *is* the editor for the prototype);
gray-matter (dormant since 2021); MiniSearch (⌘K routes through the existing FTS5 index instead of
a second search implementation).

---

## 3. Architecture

### 3.1 Monorepo (Turborepo, clean architecture + DDD)

```
pm/
├── apps/
│   └── desktop/                    # Electron app — the composition root
│       ├── electron.vite.config.ts
│       ├── src/main/               # DI wiring, IPC handlers, service startup (ESM)
│       ├── src/preload/            # typed contextBridge (CJS, sandboxed)
│       └── src/renderer/           # React app — presentation layer only
├── packages/
│   ├── domain/                     # ENTERPRISE CORE — pure TS; zod is its only dependency
│   │   └── src/{notes,signals,themes,transcripts,proposals,sessions,search}/
│   │       # zod frontmatter schemas live HERE; types via z.infer (single source of truth)
│   ├── application/                # use cases; depends only on domain (ports live here + domain)
│   ├── markdown/                   # shared kernel: unified pipeline (parse/serialize/wikilinks);
│   │                               #   consumes domain schemas for validation
│   ├── vault/                      # INFRA: fs vault + sqlite index + chokidar (main-process only)
│   ├── agent/                      # INFRA: pi.dev runtime, custom tools, pi→UIMessage bridge
│   ├── atlassian/                  # INFRA: Jira/Confluence REST adapters (+ ADF/XHTML→md)
│   ├── ipc/                        # leaf DTO contract — importable by main/preload/renderer ONLY
│   ├── ui/                         # shadcn + AI Elements + design tokens — renderer-only
│   ├── typescript-config/
│   └── eslint-config/
```

**Dependency rule (enforced by ESLint import boundaries, fully specified):**
`domain` ← `application` ← {`vault`, `agent`, `atlassian`} ← `apps/desktop/main`.
`markdown` is a shared kernel importable by `vault` and `ui` (and reads schemas from `domain`).
`ipc` is a leaf of DTOs importable only by main/preload/renderer. `ui` is renderer-only.
The **renderer never imports domain or infra** — it speaks DTOs over the typed IPC contract.
IPC payloads are structured-clone-safe plain objects; entities map to DTOs at the boundary.

All internal packages are **Just-in-Time** (exports point at `./src/*.ts`, no build step — Vite and
electron-vite transpile). Granular `exports` maps (`@pm/domain/signals`) double as DDD module
boundaries. No TS `paths` across packages (JIT forbids it) — workspace imports only.

### 3.2 Electron process model

- **Main** (ESM, `"type": "module"`): owns everything with side effects — vault fs + chokidar
  watcher, SQLite index, pi agent sessions, Atlassian HTTP, safeStorage, git. Use cases execute here.
- **Preload** (CJS, `sandbox: true`, `contextIsolation: true`): exposes **concrete per-channel
  functions generated from the InvokeMap** (not a generic `invoke(channel, …)` passthrough — closes
  the any-channel hole) plus `onAgentEvent(cb) → unsubscribe`. Never raw `ipcRenderer`, never
  leaking `IpcRendererEvent`.
- **Renderer** (React 19 + Vite 7): pure presentation. No fs, no sqlite, no secrets.

**Streaming pattern:** renderer calls `agent.run(input)` → main returns `{streamId}` immediately →
main pumps `webContents.send('agent:event', {streamId, chunk})` → renderer filters by streamId.
Chunks are AI SDK `UIMessageChunk`s (plain JSON — cross the bridge fine). **`agent.abort(streamId)`
is part of the contract from day one** (Phase 0): main aborts the pi session, tears down the pump,
and emits a terminal chunk so `useChat` leaves `streaming` state.

### 3.3 The agent runtime (pi.dev, embedded)

pi runs **in the main process** via `createAgentSession()` from `@earendil-works/pi-coding-agent`,
in **full-control mode** so a shipped app is deterministic:

```ts
const authStorage = AuthStorage.create(join(app.getPath('userData'), 'pi/auth.json'));
authStorage.setRuntimeApiKey('anthropic', keyFromSafeStorage);      // in-memory only
const modelRegistry = ModelRegistry.create(authStorage);

const loader = new DefaultResourceLoader({
  cwd: vaultDir,
  systemPromptOverride: () => PM_SYSTEM_PROMPT,       // per session type
  skillsOverride: () => ({ skills: [], diagnostics: [] }),
  agentsFilesOverride: () => ({ agentsFiles: [] }),   // don't load user's ~/.pi or AGENTS.md
  promptsOverride: () => ({ prompts: [], diagnostics: [] }),
});
await loader.reload();

const { session } = await createAgentSession({
  cwd: vaultDir,
  model: getModel('anthropic', modelId),
  tools: customToolNames,                              // ⛔ NO pi built-ins at all — see below
  customTools,                                         // defineTool() + TypeBox schemas
  authStorage,
  modelRegistry,
  resourceLoader: loader,
  // cwd first, explicit sessionDir second — otherwise sessions land in the user's ~/.pi
  sessionManager: SessionManager.create(vaultDir, join(app.getPath('userData'), 'sessions')),
  settingsManager: SettingsManager.inMemory(),
});
session.subscribe(onPiEvent);   // → bridge → UIMessageChunks → IPC
```

**Tool discipline — the core trust mechanic.** ⚠️ Verified: pi's built-in `read/grep/find/ls`
tools are **not confined by `cwd`** — they accept absolute paths and `~` expansion. A
prompt-injected transcript could otherwise exfiltrate `~/.ssh` or other projects into model
context. So the agent gets **no built-in tools whatsoever** (`tools:` lists only our custom tool
names). All reads go through custom vault-scoped tools that resolve paths and reject anything
outside `realpath(vaultDir)`:

| Custom tool | Loop | Does |
|---|---|---|
| `vault_read(path)` / `vault_list(dir?, type?, status?)` / `vault_grep(pattern)` | all | Read-only, hard path-containment to the vault |
| `search_vault(query, k)` | all | FTS5 (+vec later) over the index; paths + snippets + scores |
| `propose_triage(signalPaths[], action, themeRef?, newTheme?, groupId?, rationale)` | 1 | Emits a cluster-level triage proposal |
| `propose_note(path, frontmatter, body, rationale, sources[], inference?)` | 2 | Proposes a **new** note |
| `propose_update(path, patch, rationale, sources[], inference?)` | 2 | Proposes an edit to an existing authored/derived note |
| `jira_search(jql)` / `jira_get_issue(key)` | 3 | REST adapter; results normalized to markdown |
| `confluence_search(cql)` / `confluence_get_page(id)` | 3 | Same |

**`propose_*` handlers validate before persisting**: empty `sources[]`, or wikilink/URL targets
that don't resolve against the index / a tool result from this session → the tool call *fails*
unless `inference: true` is set (inference proposals render visually distinct). Proposals persist
as rows and return an id — they never touch the vault. The Review queue applies accepted proposals
through the application layer, which writes files and git-commits with attribution. Undo = revert
(with conflict surfacing, see §3.5).

**Session types** (triage / ingest-transcript / ask / chat) differ only in system prompt + tool
allowlist — a registry pattern like qale's `SESSION_TYPES`.

### 3.4 pi → AI Elements bridge

pi emits its own event vocabulary; AI Elements consume AI SDK `UIMessage`s. One adapter in
`packages/agent` translates, using `createUIMessageStream({ execute: ({writer}) => … })`. Chunks
are id-correlated state machines — every kind needs its start/end frames:

| pi event | UIMessageChunk |
|---|---|
| `agent_start` | `{type:'start'}` (message-level open) |
| `message_start` | `{type:'text-start', id}` |
| `message_update` (text_delta) | `{type:'text-delta', id, delta}` |
| `message_update` (first thinking_delta per msg) | `{type:'reasoning-start', id}` then `reasoning-delta` |
| `message_update` (thinking_delta) | `reasoning-delta` |
| thinking→text transition or `message_end` | `reasoning-end` / `{type:'text-end', id}` |
| `tool_execution_start/…end` | `tool-input-start` / `tool-input-available` / `tool-output-available` / `tool-output-error` |
| our `propose_*` results | **typed `data-*` parts**: `data-triage-proposal`, `data-note-proposal`, `data-search-hit` |
| `agent_end` (or abort/error) | `{type:'finish'}` — ⚠️ always terminate, or useChat hangs in 'streaming' |

The renderer uses `useChat` with a ~30-line custom `IpcChatTransport` (`sendMessages` returns a
`ReadableStream<UIMessageChunk>` fed from the push channel; `reconnectToStream` returns null for
now). Custom `data-*` parts render our domain cards — the qale pattern (MessagePart union → inline
triage card / proposal card / search results) mapped onto AI Elements.

### 3.5 The vault + state stores

User picks a directory (persisted in settings; can be an existing Obsidian vault). Layout:

```
vault/
├── signals/        # raw            type: signal
├── transcripts/    # raw            type: transcript
├── meetings/       # derived        type: meeting-summary
├── themes/         # authored       type: theme (stance: exploring|watching|committed|wont-do)
├── decisions/      # authored       type: decision
├── actions/        # authored       type: action (proposed next steps; may reference jira keys)
├── questions/      # authored       type: open-question
└── notes/          # authored       type: note (freeform + saved answers)
```

Frontmatter is the schema (zod per note type, defined in `packages/domain`). A signal:

```yaml
---
type: signal
summary: "SMB admin churned during SSO setup — quote from Gong call"   # mandatory 1-liner (token-cheap index)
status: new            # new | linked | discarded — the ONLY mutable field on a raw note
source: { system: gong, author: "Dana K.", url: "https://…" }
captured: 2026-07-12T09:30:00Z
---
Quote: "We spent three weeks on the SSO runbook and gave up."
```

Theme membership lives on the **theme**:

```yaml
---
type: theme
summary: "Enterprise admins struggle with SSO setup"
stance: watching
evidence: ["[[signals/2026-07-12-gong-sso-runbook]]", "[[signals/…]]"]
---
```

**Two stores, cleanly separated:**

- **Derived index** (`<userData>/index.db`, better-sqlite3, WAL + busy_timeout): `files(path PK,
  type, title, summary, status, mtime, frontmatter_json)`, `links(source_path, target_slug, anchor,
  alias, line)` (backlinks = `WHERE target_slug=?`), `notes_fts` (FTS5 external-content; porter
  unicode61; DELETE+INSERT in same tx as the files row), `chunks_vec` (vec0, phase 5). Fully
  rebuildable from the vault: "Rebuild index" drops and rescans; `PRAGMA integrity_check` on open →
  rebuild on failure. Startup reconciliation is a **three-way diff** (fs listing vs files table:
  add / update-by-mtime / **delete ghosts**).
- **Primary app state** (`<userData>/app.db`, separate file — *not* rebuildable, never dropped):
  `proposals(id PK, kind, session_id, target_path, base_hash, payload_json, rationale,
  evidence_json, inference, status: pending|accepted|rejected|stale, created, resolved)` + settings.

**Proposal application is staleness-safe:** `base_hash` = content hash of the target at proposal
time. On accept, rehash — mismatch marks the proposal **stale** and offers regenerate instead of
clobbering newer edits (Obsidian edits land live, so this *will* happen). The `patch` format is
**search/replace blocks** (anchor text + replacement — the format LLMs produce reliably; line-based
unified diffs are not). The review card's display diff is computed at review time against *current*
file content.

**Indexing pipeline:** one unified pass per file — `remark-parse` + `remark-frontmatter` +
`remark-gfm` + `@flowershow/remark-wiki-link` → zod-validate frontmatter → upsert. chokidar v5
watches the vault (`ignoreInitial` + own mtime scan, `awaitWriteFinish`, filter `.md`, ignore
`.obsidian/` and `.git/`); events funnel through a **debounced serial queue** (batch re-index,
yield between files) so a git pull / Obsidian Sync burst can't starve IPC. Escape hatch if agent
latency degrades under indexing load: move SqliteIndex behind a worker_thread or utilityProcess.

**Git (simple-git over system git; startup availability check):** `git init` on first open *only
after consent* if the folder isn't a repo (and detect being nested in an existing repo — ask before
committing into it). Commits are **path-scoped to exactly the files a save/accept touched** — never
`add -A`. Before applying a proposal to a file with uncommitted external edits, take a checkpoint
commit of that file so revert is well-defined. Undo = revert of a proposal's commit, surfacing
conflicts if later edits overlap — not silently "free".

---

## 4. UX skeleton (v1)

Three-pane shell, qale's layout inherited: **sidebar** (Inbox with pending-proposal count · Sessions
waiting-on-you · Themes by evidence heat · vault tree Now/Streams/Library) · **center** (landing
with capture box + suggestions, or active session chat, or note view) · **right panel** (the
note/proposal a session references). ⌘K quick switcher **backed by the FTS5 index over IPC** (no
second search engine). Global **Ask bar** (⌘⏎) starts an `ask` session from anywhere. **⌘N quick
capture** for signals is in from Phase 1 so real data accumulates while later phases are built.

Notes render read-only via react-markdown (wikilinks route in-app; backlinks footer: "linked from" +
"sessions that touched this"). Editing: authored notes get a plain markdown textarea (save →
re-index + commit); everything else, "Open in Obsidian / system editor" — in-app CodeMirror editing
is deliberately deferred (§7). Proposal cards support edit-then-accept (textarea on the payload).

Chat surfaces are AI Elements (`conversation`, `message`, `prompt-input`, `tool`, `reasoning`,
`sources`, `inline-citation`, `confirmation`, `suggestion`, `shimmer`) restyled via CSS variables to
qale's warm-clay identity; domain cards (triage stepper, proposal diff card, Jira/Confluence result
list) are ours, rendered from `data-*` parts.

Design system: `packages/ui` owns `globals.css` — all theming is oklch CSS variables + `@theme
inline` (port qale's `index.css` tokens: clay accent, Inter + Fraunces). Tweak the design = edit
one CSS file.

---

## 5. Implementation phases

Each phase ends runnable (`turbo dev --filter=desktop`) and demoable.

### Phase 0 — Scaffold (the walking skeleton)

1. `pnpm dlx create-turbo@latest` → keep `packages/{typescript-config,eslint-config}` skeleton,
   delete Next.js apps. Root: `"packageManager": "pnpm@11.12.0"`, turbo `^2.10.4`.
2. `pnpm-workspace.yaml`: `packages: ["apps/*", "packages/*"]` +
   `onlyBuiltDependencies: [electron, better-sqlite3, esbuild]` ← **without this, Electron's
   postinstall is blocked and nothing runs**.
3. `pnpm create @quick-start/electron apps/desktop -- --template react-ts` → electron-vite 5;
   pin `electron@^43.1.0`, `vite@^7`, `electron-builder@^26`. Main = ESM.
4. `turbo.json` (v2 `tasks`, `ui: "tui"`): `dev` {cache:false, persistent:true}, `build`
   {dependsOn:["^build"], outputs:["out/**"]}, `desktop#package` {cache:false}, `lint`,
   `topo`/`check-types` transit-node pattern, `test`. Declare `env: ["ANTHROPIC_API_KEY", …]`
   (strict env mode strips undeclared vars).
5. shadcn: `packages/ui` with `components.json` (style **radix-nova**, cssVariables, baseColor
   neutral — matching `components.json` in every workspace that runs the CLI), Tailwind 4 CSS-first
   `globals.css` with qale's tokens ported. Renderer CSS: `@import "tailwindcss";
   @source "../../../../packages/ui/src";` ← **required across workspace boundaries**. Keep a stub
   root `vite.config.ts` in apps/desktop so the shadcn CLI's framework detection works alongside
   `electron.vite.config.ts`.
6. `packages/ipc`: `InvokeMap` incl. **`agent:run` and `agent:abort`** + `AgentEvent` push type;
   preload exposes per-channel functions generated from the map; `window.d.ts`.
7. Hygiene: `turbo run lint check-types test` green; prettier; ESLint import-boundary rules per
   §3.1.

**Done when:** empty shell app opens with themed sidebar/panes; typed IPC ping works.

### Phase 1 — Vault core (read + capture, not an editor)

1. `packages/domain`: zod frontmatter schemas per note type (single source of truth; types via
   `z.infer`), layer rules (raw invariant as §1), `WikiLink`, backlink resolution (Obsidian
   shortest-path via the files table).
2. `packages/markdown`: unified pipeline (parse, frontmatter via `yaml`, wikilink extraction,
   serialize), consuming domain schemas; shared plugin array export.
3. `packages/vault`: `FsVault`, `SqliteIndex` (two stores + WAL + reconciliation + rebuild as
   §3.5), `VaultWatcher` (chokidar 5 + debounced serial queue).
4. Use cases: `OpenVault`, `GetNote`, `CaptureSignal` (⌘N quick capture → `signals/…md`, status
   new), `SaveAuthoredNote` (textarea saves), `SearchNotes` (FTS), `GetBacklinks`.
5. Renderer: vault tree, note read view (react-markdown + wikilink routing + backlinks footer),
   ⌘K switcher (FTS-backed), quick-capture modal.
6. Git layer (simple-git): consent-aware init, path-scoped auto-commit on capture/save.

**Done when:** point it at an Obsidian vault → browse, search, capture signals, backlinks work;
external edits (made in Obsidian) show up live; deleted files disappear from the index.

### Phase 2 — Agent runtime + chat

1. `packages/agent`: pi embedding (full-control mode, §3.3 verbatim — incl. `modelRegistry`,
   `loader.reload()`, two-arg `SessionManager.create`), session-type registry, vault-scoped
   `vault_read`/`vault_list`/`vault_grep`/`search_vault` tools with realpath containment.
2. The pi→UIMessageChunk bridge (full state machine incl. `start` and reasoning frames) +
   `agent:run`/`agent:event`/`agent:abort` IPC + `IpcChatTransport`. Stop button in the chat UI.
3. Renderer: session list (waiting/working/done), chat view with AI Elements; tool calls render
   with the `tool` component; reasoning collapsible.
4. Settings screen: vault path, Anthropic API key (safeStorage), model picker
   (`modelRegistry.getAvailable()`).
5. Sessions persist as JSONL in `<userData>/sessions`; reopen/resume past sessions.

**Done when:** you can chat with the vault ("what do we know about onboarding?"), watch it
search/read notes with streamed reasoning + cited snippets, and abort mid-run cleanly.

### Phase 3 — Loop 1: Signals → triage

1. **Demo fixtures (do this first):** author one coherent demo narrative — the SSO story — as
   ~15 signals, 2 transcripts (held for Phase 4), 3–4 pre-existing themes; plus a free Atlassian
   Cloud sandbox seeded with ENG-214-style issues and 2–3 Confluence pages that cohere with the
   story. Write the end-to-end **demo script** doc (Loop 1 → 2 → 3 tells one story).
2. `propose_triage` (cluster-level) + Proposal store (app.db) + validation semantics (§3.3);
   `triage` session type: read new signals + theme index (titles/summaries/stances), group
   duplicates, propose link / new-theme / discard with one-line rationale. The session opens with a
   digest line: *"10 signals → 3 groups: 2 match existing themes, 1 looks new."*
3. Triage UI: the qale stepper as a `data-triage-proposal` card — **the group is the unit of
   accept** (accept applies to all member signals; "not the same" splits one out), link-to-multiple,
   new-theme dialog (prefilled), skip vs discard, per-item undo, receipt at end. Accepts write:
   theme `evidence:` list + signal `status` + path-scoped commit.
4. Themes view: list by evidence heat (**evidence count + newest-signal date** — "4 signals,
   newest 2026-06-30"), stance dropdown, theme page shows evidence with provenance.

**Done when:** paste the fixture signals → run triage → accept/adjust in the stepper (~3 group
decisions, not 10) → themes show cited, dated evidence; everything visible as plain markdown in
Obsidian.

### Phase 4 — Loop 2: Transcripts → actions & updates

1. Ingest: drop/paste transcript (.txt/.md/.vtt) → `transcripts/…md` (raw, speaker-tagged if
   available).
2. `ingest-transcript` session type + `propose_note` / `propose_update` tools (validation as §3.3).
   Extraction targets: signals (verbatim quotes + speaker), decisions (what/who/rationale), actions
   (recommended next steps — issue keys appear as plain text here; verified against Jira in
   Phase 5), updates to existing notes (answer an open question, add evidence to a theme, flag a
   contradiction), meeting summary (derived note citing the transcript).
3. **Review queue** (the generalization of triage): unified pending-proposals list; each card =
   diff-at-review-time + rationale + evidence links + inference badge where flagged; accept /
   edit-then-accept / reject; stale detection via `base_hash`; batch accept. Accept applies through
   the application layer + path-scoped commit.
4. Meeting summary note links everything: `[[transcript]]`, extracted signals, decisions, actions.

**Done when:** drop the fixture transcript → review ~10 proposals in one queue (one goes stale if
you edit the target in Obsidian mid-review — and the app catches it) → accept → vault gains cited
signals/decisions/actions and a linked meeting summary.

### Phase 5 — Loop 3: Find across tools

1. `packages/atlassian`: fetch-based typed client. Jira: `POST /rest/api/3/search/jql`
   (nextPageToken, explicit `fields`), `GET /issue/{key}`; ADF→markdown walker. Confluence:
   v1 CQL search, v2 page fetch, XHTML→md via turndown. Auth: email + **unscoped** API token
   (Basic) from safeStorage — settings UX says "create an *unscoped* token"; detect scoped tokens
   (401/404 pattern) and either instruct or switch base URL to
   `api.atlassian.com/ex/jira/{cloudId}` via `GET {site}/_edge/tenant_info` cloudId discovery.
   Serialize calls, backoff on 429 honoring Retry-After; 401 → re-auth prompt (tokens expire ≤365
   days).
2. `jira_*`/`confluence_*` pi tools; `ask` session type. Citation enforcement is structural (§1):
   answer citations render from the session's actual tool-call results; unmatched links render as
   inference. Prompt adds honest absence ("no evidence — say so") and **honest confidence**
   ("2 signals, both from one account — thin"), computed from evidence counts/dates the index
   already has.
3. Answer UI: streamed response with `inline-citation`/`sources` — vault citations open the note,
   Jira/Confluence citations deep-link to browser. "Save as note" pins an answer into `notes/`
   (derived, `sources:` filled, passes the same propose-validation).
4. Stretch: hybrid retrieval — sqlite-vec `vec0` table, heading-chunked embeddings, RRF merge with
   FTS5. (Pick embedding model first — dimension is locked into the schema. Packaging must add
   `asarUnpack: ["**/node_modules/sqlite-vec*/**"]`.)
5. Stretch: background Jira sync of referenced issues → read-only work-item chips on notes
   (the tracker seam).

**Done when:** against the fixture sandbox — "What did we decide about SSO, and is there a
ticket?" → answer citing a decision note, a Gong signal, and the seeded Jira issue with a working
deep link; every citation click-through works.

### Phase 6 — Polish & package

Review-queue badge + landing suggestions ("6 new signals — 2 look like [[checkout-trust]] · ~5
min"); session receipts (reads/writes chips); keyboard pass; empty states; error toasts.
`electron-vite build && electron-builder --dir` with
`asarUnpack: ["**/*.node", "**/node_modules/sqlite-vec*/**"]`, natives-only-in-dependencies;
smoke-test the packaged app end-to-end with the demo script.

---

## 6. Risks & gotchas (pre-verified, will bite otherwise)

1. **pnpm blocks postinstalls** → `onlyBuiltDependencies` in `pnpm-workspace.yaml` from commit one.
2. **Vite 8 ≠ electron-vite 5** → pin `vite@^7` until electron-vite 6 is stable.
3. **pi is pre-1.0 and fast-moving** (0.73→0.80 in 2 months; org migration ongoing) → pin exact
   `0.80.6`, bump all `@earendil-works/pi-*` together, re-read changelog on every bump.
4. **pi's built-in file tools are not path-confined** (verified against the 0.80.6 tarball: absolute
   paths + `~` expansion) → grant no built-ins; custom vault-scoped tools with realpath containment.
   Prompt-injected content (transcripts, Jira text) is the threat model.
5. **pi loads user's `~/.pi` by default** → full-control `DefaultResourceLoader` overrides + own
   `AuthStorage`/`SettingsManager` paths + two-arg `SessionManager.create(cwd, sessionDir)`.
6. **UIMessageChunk state machine**: every kind needs start/end frames (text *and* reasoning), a
   message-level `start`, and a terminal `finish` — or the UI renders nothing / hangs.
7. **Tailwind v4 doesn't scan across workspace packages** → `@source` directives for
   `packages/ui` *and* Streamdown (`@source "../node_modules/streamdown/dist/*.js"`); verify in a
   production build, not just dev.
8. **AI Elements are vendored source** → commit them, don't re-run the CLI over modified files;
   wrap them (`packages/ui/src/chat/*`) so app code never imports the vendored files directly.
   Also: the shadcn CLI can override `components.json` style when adding from third-party
   registries (shadcn-ui/ui #10496) — check the diff after installing Elements.
9. **Jira search API changed**: legacy endpoint removed; no `total` in responses; minimal fields
   unless requested — silent-empty-results trap. And **scoped vs unscoped tokens need different
   base URLs** — handle in settings UX + client.
10. **better-sqlite3 ABI**: prebuilds cover Electron 43 (ABI 148) *today*; after any Electron major
    bump, expect `@electron/rebuild`. Keep `node:sqlite` in mind as a zero-native fallback (built
    into Electron ≥35) if native pain compounds.
11. **structured-clone IPC**: no class instances/streams across the bridge — DTOs at the boundary,
    streams flattened to chunk events.
12. **Review fatigue is the product risk** (all four concept docs agree): propose at the cluster
    level (the group is the accept unit), batch to sessions, one-tap accept, batch-accept. Log
    accept/reject/edit per proposal from Phase 3 — that data is the core eval metric
    (verification cost) and the future eval set.
13. **Stale-proposal clobbering**: external Obsidian edits land live → `base_hash` check on accept,
    stale → regenerate, never silent overwrite.
14. **WYSIWYG temptation**: any ProseMirror editor rewrites markdown on round-trip. If/when in-app
    editing lands, it's CodeMirror. (TipTap acceptable later for bounded, app-owned compose boxes
    only.)

## 7. Deferred (explicit decisions, not omissions)

- **In-app CodeMirror vault editor** (+ wikilink autocomplete, live-preview decorations): none of
  the three loops needs it — proposals are the write path and Obsidian is the editor. Revisit after
  the loops prove out.
- **Freshness/staleness sweeps and decay policies** (the docs' "failing test for product work"):
  deferred as a mechanic; the cheap partial — evidence counts + newest-signal dates on themes and
  in answers — ships in Phases 3/5, and `captured` dates in frontmatter keep the door open.
- **Cold-start bootstrap** ("First Brief": draft-brain from backfilled sources, correct-don't-author
  onboarding): adoption-critical for the real product; the Phase 5 Confluence adapter + Phase 3
  triage stepper are its building blocks when we get there.
- Slack/Intercom/Gong connectors (paste-in is the universal fallback); audience lenses / stakeholder
  update rendering; scenario branches (git branches of the brain); auto-apply trust tiers; OAuth
  3LO Atlassian app (API token is fine single-user); Rovo MCP server integration; multi-vault/team
  features; a formal evals harness (but the accept/reject/edit log from Phase 3 *is* the future
  eval set).
