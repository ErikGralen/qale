# Claude Code integration: implementation tickets

The design is docs/claude-code-integration.md. Every open question in it
is answered; this doc is the build plan. CC-1..7 are the spine, in
order. CC-8..11 hang off it.

## Context a subagent needs before touching any ticket

The decisions, so you never have to reopen the design doc:

- Qale never writes code and never asks Claude Code to write code.
  Reports only. The runner must make writes impossible, not just
  discouraged.
- The tool is `ask_codebase`, in the session engine's toolbox. It is
  not injected at all when no codebase is configured.
- Codebase settings accept several paths. Each path is a repo or a
  folder of repos. A repo is a directory with a `.git`.
- Every run needs user approval on a card first. The card shows the
  question, the repo, and the suggested model with one line of why.
  The model picker is active when the run starts a new Claude Code
  session. A run that resumes an existing session shows the model as
  fixed; switching models means starting a new session.
- Claude Code sessions persist across tool calls: a run returns a
  session id, and a later call can pass it to `--resume` for
  follow-ups with full context.
- Freshness is pull-before-run: `git fetch` + fast-forward pull right
  before a run, skipped if the repo was pulled in the last 15 minutes.
  Per-path toggle. Never touch a dirty tree or a non-default branch.
- Reports are session files, not workspace notes. Provenance (repo,
  commit, date, model, session id) travels with the file.
- Scheduled runs never call the codebase. Same fail-closed rule as
  `ask_user` (packages/agent/src/ask.ts:513).
- Discoverability: a settings section and nothing else. No Home
  mention, no onboarding mention.

House style: CLAUDE.md applies to every user-facing string you write,
including tool descriptions and card copy. No em dashes.

Patterns to copy, not reinvent:

- Approval card: the spawn flow. Tool dep `requestApproval`
  (packages/agent/src/spawn.ts:184-200), runtime `askToSpawn` +
  in-memory `pendingSpawns` (packages/agent/src/runtime.ts:1565-1593),
  push channel `session:spawn` (packages/ipc/src/events.ts:92-101),
  invoke `sessions:resolveSpawn` / `sessions:pendingSpawn`
  (packages/ipc/src/index.ts:248-253), renderer
  SpawnCard.tsx. Pending approvals do NOT survive a quit; they cancel
  like `cancelSpawns` (runtime.ts:1866-1873). Keep that.
- Tool gating: `toolNamesFor` (runtime.ts:455-528) narrows a static
  registry (runtime.ts:1040-1088). One new `if` line, one new name
  constant.
- Session files: `writeSessionFile` and friends
  (packages/agent/src/session-files.ts:70-140).
- External text entering the transcript gets the external-material
  envelope (see `wrappingRead`, session-files.ts:213-230).
- Git: `simple-git` is already a dependency; the vault's git layer
  (packages/vault/src/git.ts) is the prior art.
- Settings: one `PersistedSettings` record in userData settings.json
  (apps/desktop/src/main/services/settings-service.ts:85-190).

## CC-1: settings record and IPC

Add `codebase` to `PersistedSettings`
(settings-service.ts:85-165):

```ts
codebase: {
  paths: Array<{ path: string; gitPull: boolean }>;
} | null
```

No secrets, so no `*Enc` fields. Defaults: `null`. Getter and setter
on the settings service beside `setAtlassian` (:449). IPC: add
`codebase:get`, `codebase:set`, and `codebase:status` channels next to
the `connections:*` block (packages/ipc/src/index.ts:282-328), with
handlers in apps/desktop/src/main/handlers.ts near :1251. `status`
returns what CC-2 discovers. DTOs in packages/ipc/src/dtos.ts.

## CC-2: discovery and the `claude` probe

A main-process service, `apps/desktop/src/main/services/codebase-service.ts`:

- `discoverRepos(paths)`: for each configured path, if it has a
  `.git` it is one repo; otherwise each direct subdirectory with a
  `.git` is a repo. Return `{ name, dir, parentPath }[]`. `name` is
  the directory basename; if two repos collide on basename, qualify
  with the parent folder.
- `probeClaude()`: run `claude --version` with `execFile`. Gotcha: a
  macOS GUI app does not inherit the login shell PATH, so resolve the
  binary through the user's shell once (the `xcode-select -p` probe in
  packages/vault/src/git.ts:57 is the closest prior art; a
  login-shell `command -v claude` is the reliable check). Cache the
  resolved absolute path; every later spawn uses it.
- Both feed `codebase:status`: `{ claude: { ok, version | reason },
  repos }`.

## CC-3: the settings section

- Add a `codebase` entry to `SETTINGS_SECTIONS`
  (apps/desktop/src/renderer/src/lib/settings-sections.ts:37-79) and
  a matching `TabsContent` panel in SettingsView.tsx (tab strip at
  :247). Label: "Codebase".
- The panel: add/remove paths (folder picker), per-path "Keep up to
  date with git" toggle, the discovered repo list under each path,
  and a status line for the `claude` binary ("Claude Code found,
  v2.x" or what is missing and that the feature stays off without
  it).
- Nothing outside this panel advertises the feature. No Home card, no
  onboarding change, no ⌘K keyword beyond the section itself.

## CC-4: pull-before-run

In codebase-service.ts:

- `freshen(repo)`: skip and return the current HEAD when `gitPull` is
  off for the repo's path, when the last pull for this repo was under
  15 minutes ago, when the working tree is dirty, or when HEAD is not
  the default branch. Otherwise `fetch` + fast-forward-only pull with
  `simple-git`. If fast-forward is impossible, leave the repo alone.
- Always return `{ commit, branch, freshened, skippedWhy? }` so the
  report provenance can say what state the code was in. A wrong merge
  in the user's clone is worse than a stale answer; never merge,
  never stash, never checkout.
- Last-pull times live in memory keyed by repo dir. Losing them on
  restart only costs one extra pull.

## CC-5: the headless runner

The part that actually runs Claude Code. In codebase-service.ts, plus
a port so the agent package stays process-clean:

- Port: `CodebasePort` in packages/application/src/ports.ts, beside
  `OutboundPort` (:328). Shape:
  `run(req: { repoDir, prompt, modelId, resumeSessionId? }) =>
  Promise<{ text, sessionId, commit }>`. Injected on `UseCaseContext`
  like `outbound` (:341); absent when unconfigured, and `!!ctx.codebase`
  is the gating flag CC-6 reads (same read-fresh-each-call rule as
  `connected`, runtime.ts).
- Implementation: `freshen(repo)` first (CC-4), then spawn the
  resolved `claude` binary with `cwd: repoDir`, `-p <prompt>`,
  `--output-format json`, `--model <modelId>`, `--resume <id>` when
  resuming, and a read-only tool policy: allow the read tools, deny
  Write, Edit, and Bash outright. Verify the exact flag names against
  the installed CLI's `--help` at implementation time and put the
  final invocation in one function with a comment; the CLI's flag
  surface moves.
- Parse the JSON result into `{ text, sessionId }`. A non-zero exit,
  a timeout (10 minutes), or unparseable output rejects with a
  one-line reason; the tool (CC-6) turns that into tool text, never a
  thrown turn.
- The child process dies with the app and with session abort. No
  detached processes.

## CC-6: the `ask_codebase` tool

In packages/agent, its own module beside spawn.ts, shaped like it:
pure planning and validation, then an approval dep, then a runner dep.

- Parameters: `question` (instructions to Claude Code, written for a
  reader who knows the repo and nothing about Qale), `repo` (name
  from the configured list), `suggested_model` (one of the CC-7
  catalogue ids), `why` (one line: why this model fits this
  question), `resume` (optional Claude Code session id from an
  earlier result).
- Validation errors return as tool text: unknown repo (list the known
  ones), unknown model, `resume` id the session never saw.
- Scheduled runs refuse outright, same rule and wording pattern as
  ask.ts:513.
- Flow: validate, `requestApproval` (parks, CC-7), then
  `ctx.codebase.run(...)` with the approved model. On success:
  1. Write the full report to session files as
     `codebase/<NN>-<repo>-<slug>.md` via `writeSessionFile`, with a
     provenance header: repo, commit, branch, date, model, session
     id, and `freshened`/`skippedWhy` from CC-4.
  2. Return tool text: the report wrapped in the external-material
     envelope (wrappingRead is the pattern, session-files.ts:213),
     plus the file path and the Claude Code session id for
     follow-ups.
- Gating: name constant in tools.ts, registry + customTools entries
  (runtime.ts:1040-1088), and one line in `toolNamesFor`: active only
  when the workspace has a codebase configured AND the `claude` probe
  passed. No `can:` capability; configured means available, like the
  Atlassian tools (runtime.ts:520).
- Track issued session ids per Qale session in the tool's closure so
  `resume` validation works and CC-7 knows whether a run is new or a
  resume.

## CC-7: the approval card

Modeled line for line on the spawn flow. Runtime side:

- `CodebaseRequestInfo`: id, sessionId, question, repo,
  `suggestedModelId`, `why`, `models: ModelInfo[]`, `resume: boolean`,
  `offered` (same `isOffered` stamp, ask.ts:167). Pending map +
  `askCodebase` beside `askToSpawn` (runtime.ts:1565), `asked = true`
  on park, cancel-on-abort beside `cancelSpawns` (runtime.ts:1866),
  rehydration getter beside `pendingSpawn` (runtime.ts:1850).
- The model catalogue is NOT the BYOK list. It is what the `claude`
  CLI accepts, one module, one constant:
  Sonnet, Opus, Fable 5, with the CLI's alias strings as ids. Verify
  the accepted aliases against the installed CLI at implementation
  time.
- Decision: `{ approved, modelId? }`. When `resume` is true the card
  offers no picker and the decision carries no modelId; the run keeps
  the session's model. Switching models means the agent starts a new
  session, which raises a card with the picker again. Put that
  sentence in the tool description so the model knows the rule.

Wire and renderer:

- DTO + push channel `session:codebase` beside `session:spawn`
  (packages/ipc/src/events.ts:92-101, dtos.ts:617-646), invoke pair
  `sessions:resolveCodebase` / `sessions:pendingCodebase`
  (index.ts:248-253), handlers beside :2061, event intake in
  app-state.tsx beside :1933.
- `CodebaseCard.tsx` beside SpawnCard.tsx, rendered from
  SessionView.tsx beside :1177. Contents: the question (expandable if
  long), the repo, the model row (picker when new, fixed label when
  resuming) with the `why` line under it, approve and cancel. Copy in
  house style: "Ask the codebase", "Run", "Not now".

## CC-8: prompt guidance

- `promptGuidelines` on the tool (the ask.ts:349 pattern): when a
  product question depends on what the code actually does, ask the
  codebase instead of guessing; answers cost real minutes, so batch
  what you want to know.
- A conditional prompt section, `codebasePrompt(repos)`, exported from
  the tool's module and appended in the `baseSystemPrompt` chain
  (runtime.ts:999-1010) only when the tool is active, same as
  `sessionFilesPrompt` (session-files.ts:336). It lists the repo
  names, states the resume rule (follow-ups reuse the session id,
  new topic means new session), and the model guidance: suggest the
  cheap model for greps and summaries, the strong models for
  architecture judgement, and always say why in one line.

## CC-9: the tell-qale handoff learns about the tool

tell-qale currently hands the PM a fenced prompt to paste into
`claude` by hand (packages/sessions/src/defaults.ts:571-615). Add a
rule to the skill: when `ask_codebase` is available, run the overview
through it directly instead of the copy-paste handoff, and keep the
handoff as the fallback when it is not. Edit
`packages/sessions/src/defaults.ts` AND `vault-dev/skills/tell-qale/`
together (the rule is stated at defaults.ts:39-44); run
`pnpm refresh-demo` after.

## CC-10: telemetry

One new event in `TELEMETRY_EVENTS` (packages/ipc/src/telemetry.ts:175+):
`codebase.asked`, with a `says` line in consent-screen language, props:
`model` (word, the catalogue ids), `resumed` (flag), `approved`
(flag). Send from the main-process resolve handler beside the other
`handlers.ts` call sites. Unknown props are dropped by the filter, so
add the vocabulary properly.

## CC-11: tests

- Planning/validation table tests beside spawn's: unknown repo,
  unknown model, bad resume id, scheduled refusal, approval declined
  means no runner call.
- Runner parsing against fixture JSON: success, non-zero exit,
  garbage output, timeout. No real `claude` in CI.
- `freshen`: each skip reason (toggle off, under 15 minutes, dirty
  tree, non-default branch, no fast-forward) against temp git repos,
  and that provenance reports the truth in each case.
- Discovery: path-is-repo, folder-of-repos, basename collision.
- Approval round-trip: park, resolve, cancel-on-abort, rehydration
  after a tab reopen, resume runs carry no picker.
- Report file: lands under `codebase/`, provenance header complete,
  tool text wears the external-material envelope.

## Explicitly out of scope

- Any write path into a repo. No branches, no PRs, no `git` beyond
  fetch and fast-forward pull.
- Scheduled or librarian-initiated codebase runs.
- Indexing or embedding the repo.
- Featuring the capability anywhere outside the settings section.
