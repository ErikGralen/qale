# Next steps — pm workspace OS

Product review, 2026-07-18. Scope: full codebase (renderer, main process, packages) plus the uncommitted editor-v2 work. Baseline health is good: typecheck and all 21 tests pass, and the Electron security posture is solid (sandbox, contextIsolation, closed preload channel list, realpath-based vault containment, secrets never sent to the renderer). The findings below are ordered by what to do, not by where it lives. Lens throughout: this is an MVP for PO/PMs — prefer deleting and simplifying over adding.

---

## 1. Bugs — fix now

### P0 (verified, user-visible or data-destroying)

1. **Every session prompt is missing its final skill section.** `section()` in `packages/sessions/src/skill.ts:119` uses `\Z` as an end-of-string anchor, which doesn't exist in JS regex (it matches a literal "Z"). The last `##` section of every skill body — `## Then` in all shipped skills — is silently dropped from the system prompt. Reproduced with a minimal case. Fix: `(?=^#{1,3}\s|$(?![\s\S]))`. Add a regression test that checks the *last* section (the existing test only checks `when`/`produce`, which is why this slipped through).

2. **Vault commits land in the source repo.** `vault-dev/` has no `.git`, so `GitAdapter.isRepo()` (`packages/vault/src/git.ts:33`) falls through to `checkIsRepo()`, whose default checks "inside *any* work tree" — true because vault-dev sits inside the pm repo. Result: 224 of the 261 commits in this repo are vault content ("edit: meetings/…", "session: commitment-check"). Fix: make `isRepo()` require that the vault root *is* the repo root (`CheckRepoActions.IS_REPO_ROOT`, or compare realpathed `rev-parse --show-toplevel` to the vault root), and on vault open call the currently-dead `init()` so each vault gets its own repo (see feature #1 below). Also fix `init()`: it sets `user.name` but not `user.email` (commits fail without a global git identity) and never writes the `.gitignore` its comment promises.

3. **Lenient frontmatter read + write-back destroys user frontmatter.** `coerceFrontmatter` in `packages/vault/src/fs-vault.ts:189` falls back to `{type:'note', sources: []}` when validation fails, discarding all original frontmatter in memory; the next body save writes `existing.frontmatter` back to disk (`notes.ts:346`), permanently erasing the real fields. Any note with slightly-off frontmatter (e.g. `status: wip`) is one edit away from data loss. Fix: preserve the raw frontmatter on validation failure (parse leniently, never round-trip the coerced fallback back to disk).

4. **Restored doc tabs never load.** On boot, only the *active* tab's content is fetched (`app-state.tsx:905`), and `NoteView` never self-fetches — it only reads `docData[path]` — so switching to any other restored tab shows the skeleton forever. Same class of bug: Inbox evidence chips pass a wikilink slug directly to `openDoc` (`InboxView.tsx:1255`), but `note:get` expects a file path → permanent skeleton. Fix both by having `NoteView` load when its data is missing, and routing evidence chips through `note:resolveLink` like every other surface already does.

5. **Deleting the note you're viewing strands the UI.** `deleteNote` (`app-state.tsx:874`) removes the tab but never repairs `activeTabId` (unlike `closeTab`): the center shows Landing, no tab is highlighted, and ⌘W is dead until a manual tab click.

### P1 (real, lower frequency)

6. **Git errors are swallowed silently.** `commitPaths` (`git.ts:50`) has a bare `catch {}` — a permanently broken git setup disables versioning forever with zero signal. One known trigger: renaming a never-committed note makes `git.add(deletedPath)` throw, silently skipping the whole commit. Log at minimum.

7. **Fire-and-forget sessions crash silently without an API key.** `void fireSession(...)` in `handlers.ts:395,400,448` has no `.catch`; `AgentRuntime.run` throws when unconfigured, so capture follow-ups and reactions die as unhandled rejections with no user signal. Surface a ping/notice instead.

8. **Proposals/pings are not scoped per vault.** They live in a global `app.db` with no vault column (`proposal-store.ts:33`, `vault-service.ts:41`); switching vaults carries vault A's pending cards into vault B, and accepting one writes A's path into B.

9. **A `note`-kind proposal can silently overwrite an existing file.** `acceptNote` (`proposals.ts:160`) writes `payload.path` unconditionally — no exists/staleness check like `update` cards have — and `previewProposal` shows `before: ''`, so the reviewer's diff never reveals the clobber.

10. **Watcher batch loss.** `drain()` clears `pending` before `onBatch` runs and has no catch (`watcher.ts:62-80`); if reindex throws, those file changes are permanently dropped from the index as an unhandled rejection.

11. **The frontmatter mutability invariant is enforced by nothing.** `checkFrontmatterMutation` (`notes.ts:468`, `invariant.ts:72`) — immutable meeting provenance, append-only decision fields — is called only by its own test; `note:saveFrontmatter` just schema-validates. Either enforce it there or delete the module (decide; don't leave it half-real).

12. **Inbox keyboard accept bypasses the stale guard.** Enter/`a` accept a focused card without checking `preview.stale` (`InboxView.tsx:368`), and a stale-rejected accept produces no feedback at all — a silent no-op in the one surface whose contract is "nothing silent."

13. **MCP server lifecycle.** `stop()` doesn't await `close()` or destroy open connections, so `restart()` can hit EADDRINUSE, and a failed bind still reports "running" to Settings (`mcp-service.ts:29-45`). Requests also run as `void this.handle(...)` with no try/catch — a transport error hangs the HTTP response.

14. **Concurrent `run()` on one session interleaves turns.** `runtime.ts:409` has no in-flight guard: a second run reroutes the first turn's events and invokes `session.prompt()` concurrently. A simple "session busy" rejection is enough for an MVP.

---

## 2. Remove — dead weight (~2,500+ lines)

All verified by grepping for usage; deleting these costs nothing.

- **Smart views are unreachable.** Nothing calls `openSmartView` (`app-state.tsx:416`); the view renders only via stale persisted tabs. Delete `SmartViewPage.tsx`, `state/smart-views.ts`, the `smartview` tab kind — or wire it up deliberately (see features). Don't leave it limbo.
- **~1,800 lines of unused shadcn components in `packages/ui`**: attachment, dropdown-menu, item, input-group, bubble, table, avatar, empty, card, message, marker, toggle/toggle-group, tabs, tooltip, textarea, scroll-area, Logo. Only Button, Badge, Collapsible, Input, Resizable, Separator, Spinner, Dialog, Command, ThemeProvider are actually imported.
- **`packages/agent/src/prompts.ts:45-99`** — `SESSION_TYPES` + four long prompt constants: never imported, and they've drifted from the real skills in `sessions/defaults.ts`. Only `SHARED_PREAMBLE` is used.
- **`packages/domain/src/notes/truth-delta.ts`** — whole 93-line module (6 zod schemas), referenced only by its own test.
- **Dead IPC + use-cases**: `refreshFolderIndexes` + its `vault:refreshIndexes` channel (no caller), `getOverdueTodos` (scheduler reimplements it inline), `setNoteStatus`, `refreshSource`, `setProblemStance` + its channel.
- **Small dead ends**: the `bool` widget branch in `PropertiesBlock.tsx:288` (no field uses it), `ContextInfo.byType` (`contexts.ts:29`), `duePhrase` in `todo-parse.ts`, `QuickAdd.onAdded` (`TodosView.tsx:69`), `chainHead`, `STANCE_ORDER`, `pathFromSlug`, `ParsedNote.links`/`hasFrontmatter` (computed on every `readNote`, then thrown away — a full remark parse wasted per read).
- **`seedDemoProposal`** — 55 lines of Tavla demo fiction inline in `handlers.ts:63-125`; move to a dev-only module alongside `seed-demo.ts`.

---

## 3. Clean up / refactor

Highest leverage first; none are urgent, all reduce drift risk.

- **Split `InboxView.tsx` (1,426 lines)** into `components/inbox/`: the approval card (CardItem + DiffBlock + diffLines, ~300 lines) and the librarian rows (~300 lines), leaving a ~500-line view with the focus-index math isolated and testable.
- **Kill the copy-paste quintet**:
  - note-type→icon map ×3 (`Sidebar.tsx:39`, `TabStrip.tsx:9`, `MemoryView.tsx:21`)
  - scoped-Ask composer, byte-identical ×2 (`FolderView.tsx:284`, `ContextView.tsx:101`)
  - favorites-persistence try/catch ×3 in `app-state.tsx`
  - local `YYYY-MM-DD` today ×3
  - wikilink-ref stripping ×5, each slightly different (`tools.ts:553`, `sqlite-index.ts:167`, `decisions.ts:20`, `vault.ts:190`, `normalizeLinkTarget`) — one of these (`stripBrackets`) doesn't handle alias/anchor; this is a latent-bug factory. One domain helper should own it.
- **`notifyProposals` is a byte-for-byte duplicate** of `notifyProposalsFor` in the same closure (`handlers.ts:418` vs `172`).
- **`PUSH_CHANNELS` in the preload is hand-maintained** (`preload/index.ts:17`) and will silently drop any new push channel; export a runtime array from `@pm/ipc` like `INVOKE_CHANNELS` already does.
- **Merge `ProposalStore` + `PingStore`** — two classes, two connections to the same `app.db`, identical `hash()` helpers. (Natural moment to add vault scoping, bug #8.)
- **The `/index.md` exclusion filter is hand-copied 9+ places** and *missing* from `getProblemsByHeat` and the agent's `vault_list`. Centralize.
- **Frontmatter round-trips are not byte-stable**: `parseFrontmatter` merges zod defaults back in and `serializeNote` trims body edges, so a body-only save rewrites frontmatter — contradicting the "never rewrite bytes we didn't touch" goal and producing noisy git commits.
- **Startup order**: `onReady` awaits the librarian sweep before `createWindow()` (`index.ts:97`), delaying first paint, and the initial badge events are pushed to a window that doesn't exist yet and dropped. Create the window first, run `afterOpen` in the background.
- **Editor popups**: `suggestion-popup.ts` reimplements what `@tiptap/suggestion` 3.27 ships as `props.mount` (floating-ui popup with autoUpdate *and* outside-click dismissal). Adopting it deletes ~80 lines and fixes the missing outside-click dismissal for free.
- **Defer, deliberately**: `packages/ipc/dtos.ts` (472 lines) hand-mirrors domain types 1:1, and `application/ports.ts` gives every port exactly one implementation with no test doubles. Both are one hexagon more than an MVP needs, but collapsing them is churn without user payoff — leave them until they actively hurt, then collapse rather than extend.

---

## 4. Improvements (UX / robustness)

- **Adopt one error-surfacing pattern (a toast/notice) and use it at the silent-failure points**: `CaptureDialog.submit` (the app's primary capture path fails silently today, `CaptureDialog.tsx:132`), `TodosView.flip` (optimistic checkbox silently reverts), `SettingsView` save handlers (invalid API key → no feedback), and bug #7's fire-and-forget sessions. This one pattern fixes four findings.
- **Confirm before deleting a conversation** — currently a single un-confirmed click on a hover-revealed trash icon next to Reopen (`ChatsView.tsx:225`). `NoteView` already models the confirm pattern.
- **Secrets on machines without a keyring**: when `safeStorage` is unavailable, keys are silently stored as plain base64 while the doc comment claims "encrypted at rest" (`settings-service.ts:122`). Warn or refuse; don't claim.
- **Ship the editor-v2 WIP.** The reviewer's verdict: coherent, fully wired, typecheck-clean, committable as-is — commit it. Three follow-ups shortly after:
  1. The toolbar's "link to note" inserts `[[text` where the suggestion plugin's `allowedPrefixes` won't fire after punctuation, stranding literal `[[` in the doc (`SelectionToolbar.tsx:86`).
  2. Custom-property rows stringify non-string values (`safe_space: true` → `"true"`) and allow one-click deletion of agent-managed keys (`PropertiesBlock.tsx:165`).
  3. Reset `selectedIndex` when the suggestion query changes (`suggestion-render.tsx:46`), and dedupe the block registry shared by "Turn into" and the slash menu.

---

## 5. New features — a short list, on purpose

The product surface is already broad for an MVP (vault, agent, inbox, todos, librarian, scheduler, MCP, outbound). Most "next feature" energy should go into the fixes above, which make existing features trustworthy. Only additions that complete already-built stories:

1. **Vault git init on open (with consent).** The one genuinely missing piece of the versioning story: today the app never creates a vault repo, so git-backed history only works if the user pre-inits one — and bug #2 means it actively pollutes a parent repo otherwise. Small, and it unlocks the next item.
2. **Note history from git.** Once vaults reliably have their own repo, a minimal "previous versions of this note" panel (list of commits touching the file + view) is high PM value for low effort, and it makes the versioning feature *visible* — right now git-backed history has zero UI payoff.
3. **Decide smart views: wire or delete.** If saved filtered views earn their keep for PM workflows (e.g. "open decisions", "stale insights"), add a single entry point from the sidebar. Otherwise delete (section 2). The worst option is the current state.

Explicitly **not** now: more outbound integrations, multi-vault UX polish, collaboration/sharing, mobile, plugin systems. Nothing in the review suggests users are blocked on any of these.

---

## 6. Test gaps (only where the logic is genuinely risky)

- **`packages/vault` has zero tests** and holds the most safety-critical code: `FsVault.contain()` (the path-containment guard every agent tool relies on), sqlite reindex/resolve/backlinks, `GitAdapter.commitPaths`, the watcher drain loop.
- **`packages/markdown` has zero tests**: the `parseNote`/`serializeNote` roundtrip feeds bug #3's destructive path.
- **`application/proposals.ts`**: `applyPatch`, `contentHash` staleness, supersede flip — all execute file writes, none covered.
- Plus the skill-section regression test from bug #1.

A pragmatic MVP bar: one roundtrip test for markdown, one for frontmatter coercion, one for `contain()`, one for the git root guard. Four tests would have caught the four scariest bugs in this review.

---

## Suggested sequencing

1. **Week 1 — trust**: bugs #1–#5 (skill regex, git root, frontmatter destruction, dead tabs, delete-strand), plus the four regression tests. These are the ones that lose data or silently degrade the agent.
2. **Week 2 — hygiene**: section 2 deletions (one PR, ~2,500 lines lighter), error-surfacing pattern, commit editor-v2 with its three follow-ups.
3. **Week 3 — completion**: vault git init + note history, P1 bugs (#6–#14), InboxView split, dedupe pass.
