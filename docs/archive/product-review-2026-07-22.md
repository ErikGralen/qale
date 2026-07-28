# Product review — 2026-07-22

Full-codebase + product review of the Produktminnet MVP (main process, renderer, shared packages, product scope/docs). Findings verified against the actual code; each cites file:line. MVP mindset throughout — pragmatic fixes, not enterprise purity.

**TL;DR — the five things to do first:**

1. **Fix the agent write path's broken invariants** (bugs 1–2 below): accepted `update` cards bypass every mutability rule and rewrite human-owned frontmatter with coerced in-memory fallbacks. This is the exact bug class (frontmatter-erasing round-trips) that was P0 last week — it's still open on the *agent* path.
2. **Don't ship the Confluence drift-fix write path as-is** (bug 3): approving a drift card *appends a full duplicate page* through a lossy converter instead of updating.
3. **Fix the two data-loss/deadlock renderer bugs** (bugs 4–5): silent permanent autosave failure, and "Approve all" deadlocking at streak 5.
4. **Kill or finish the mocked Connections surface**: it's the only place the product lies to the user.
5. **Add CI** (typecheck + tests on push) — the suite is currently red in two places and nobody noticed.

---

## 1. Bugs

### High

1. **(FIXED — via jira-confluence-review M7)** **Accepted `update` cards bypass every mutability invariant.**
   `packages/application/src/use-cases/proposals.ts:255-291` (`acceptUpdate`) never calls `isBodyEditable` / `checkFrontmatterMutation` before writing. The invariants in `packages/domain/src/notes/invariant.ts` are only enforced in `saveAuthoredNote`/`saveFrontmatter`/`renameNote` — not in the agent's proposal→accept path (nor in `packages/agent/src/tools.ts` or the desktop handlers). So the agent can body-patch an append-only decision, rewrite a frozen session receipt, or flip immutable ticket identity fields. The domain rules are decorative for the one write path that matters most.

2. **(FIXED — `acceptUpdate`/`applyLibrarianPatch` use `writeBody`; `markCitedSourcesProcessed`/`setTodoStatus` still pending the `patchFrontmatterField` refactor, §4.4)** **Body-only update cards rewrite frontmatter with the coerced in-memory fallback.**
   `acceptUpdate` (`proposals.ts:277`) and `applyLibrarianPatch` (`pings.ts:364`) call `vault.writeNote(path, note.frontmatter, applied)` even for body-only changes. `note.frontmatter` is the *coerced* object from `FsVault.coerceFrontmatter` (`packages/vault/src/fs-vault.ts:175-207`) — fabricated summary, zod defaults, permissive fallback for unmodeled YAML. `writeBody` exists precisely for this contract (`ports.ts:56-61`) but these paths don't use it. Accepting a librarian link-fix on an externally-authored note silently normalizes its frontmatter (key reorder, comment loss, injected defaults). Same latent issue in `markCitedSourcesProcessed` and `setTodoStatus`.

3. **(tracked in jira-confluence-review H2)** **Accepted wikipage-drift card corrupts the live Confluence page.**
   `sweepWikipageDrift` builds a fix whose body is the **full corrected page** (`wikipage-drift.ts:283-286`), but `AtlassianClient.updatePage` (`packages/atlassian/src/client.ts:278-296`) **appends** (`currentBody + markdownToStorage(...)`), through a lossy converter (only h1–h3/bullets/paragraphs survive; macros, links, tables, bold destroyed). Approving a drift card leaves the page with its old contradicting content *plus* a mangled duplicate copy. Three-way semantic mismatch: the sweep assumes "replace", the port says "update", the client does "append". Confirmed end-to-end via `apps/desktop/src/main/services/outbound-service.ts:36`.

4. **(FIXED)** **Failed autosave is silently swallowed forever (data loss).**
   `apps/desktop/src/renderer/src/components/NoteEditor.tsx:85-99`: `flush()` sets `lastSaved.current = md` *before* awaiting `onSave`. On failure, every later flush hits `sameBody(md, lastSaved.current)` and returns — the edit never retries, the file on disk stays stale, and the only signal is `console.error`. It also blocks the external-change resync path (line 177). Fix: reset `lastSaved` on failure + surface via the existing `useToast`.

5. **(FIXED)** **Inbox batch-accept deadlocks once the streak hits 5.**
   `apps/desktop/src/renderer/src/app/InboxView.tsx:217-246` + `bumpStreak` (154-159): the spot-audit check breaks out of `acceptCards` *before accepting anything*, and the audit banner's "Got it" doesn't reset `streak`. At streak 5, every "Approve all"/"Fix all N" accepts zero cards and re-raises the banner. Reachable in a normal demo flow.

6. **(FIXED)** **Failed vault switch leaves the app running against a closed database.**
   `apps/desktop/src/main/services/vault-service.ts:46-78`: `open()` stops vault A's watcher, clears the shared index, and closes A's app DB *before* the fallible `openVault(ctx)` call. If it throws, `this.ctx` still points at A — every proposals/pings call now throws "database connection is not open" and `vault:tree` returns empty. Related: sessions started under vault A keep A's captured ctx after a *successful* switch and write against a closed DB. Fix: build the new state first, only then tear down the old.

### Medium

7. **(FIXED — both suites green)** **The test suite is red in two places** (found by running `pnpm test`):
   - `apps/desktop/test/wikilink.test.ts` crashes at import: a transitive import of `renderer/src/lib/ipc.ts:7` touches `window` at module load, which doesn't exist in the Node test env.
   - `packages/sessions/test/sessions.test.ts:24` is stale: the after-meeting skill now has 3 red flags, the test asserts 2.
   Neither is caught because there is no CI (see §6).

8. **(FIXED)** **Any settings change silently kills all live agent sessions.**
   `handlers.ts:96-120` → `runtime.ts:139-153`: `configure()` unconditionally `disposeSessions()` mid-stream on every `settings:setModel`/`setAnthropicKey`/`setAtlassian`/`vault:open`. Touching the Atlassian token while an after-meeting run streams kills the run the user is waiting on. Skip dispose when config is unchanged, or let in-flight sessions finish on the old config.

9. **(FIXED)** **Enabling a weekly schedule fires it immediately.**
   `services/scheduler-service.ts:43-51`: toggling on leaves `lastRun: null`, so the next 5-minute tick sees last week's slot and fires. Stamp `lastRun` when `enabled` flips to true.

10. **(tracked in jira-confluence-review M10)** **Unhandled promise rejection in the 5-minute maintenance tick.**
    `handlers.ts:226-229`: `void runLibrarianSweep(ctx).then(...)` with no `.catch`; the scheduler's try/catch only covers the synchronous call. A persistent failure = an unhandled rejection in main every 5 minutes. One `.catch` fixes it.

11. **(FIXED)** **Double-submit race duplicates a session.**
    `packages/agent/src/runtime.ts:482-485`: the `activeStreamId` guard runs *after* the async `createSession`. Two rapid `agent:run` calls with the same id both create a `SessionState` and both write the same JSONL interleaved. A per-sessionId in-flight promise closes it.

12. **(FIXED)** **Meeting→transcript link never indexed (key typo).**
    `packages/vault/src/sqlite-index.ts:150-161` indexes frontmatter key `transcript_ref`, but the schema field is `transcript` (`frontmatter.ts:133`); `meeting` matches nothing either. Every transcript source looks like an orphan → recurring bogus "no links" librarian pings; and `renameNote`'s cited-check misses the ref, so retitling a transcript breaks the meeting's pointer. One-line fix.

13. **(FIXED — refuses with a clear error, card stays pending)** **Accepted `message` drafts can be silently discarded.**
    `proposals.ts:365-377`: if `linkBackPath` is absent or the note unreadable, the card is still marked `accepted`, the drafted body goes nowhere, and the caller gets `{ ok: true }`. Refuse or fall back to writing a draft note.

14. **(FIXED)** **Wikilink resolution silently picks an arbitrary note on ambiguous basenames.**
    `sqlite-index.ts:237-248` resolves a bare basename to the *shortest slug* among matches instead of refusing ambiguity — contradicting the product's own link-repair philosophy ("two plausible targets is a conversation", `link-repair.ts:9-11`). Backlinks and evidence validation inherit the wrong binding.

15. **(FIXED)** **URL evidence refs become dangling-link noise.**
    `zRef` explicitly allows URLs (`proposals/index.ts:156`) but the indexer pushes every ref through `refToSlug` with no URL filter (`sqlite-index.ts:163-169`) → every sweep generates bogus judgment-call pings for URLs, sometimes with absurd "did you mean" candidates.

16. **(FIXED — clock emits local-offset ISO; note-status parses local)** **All "today" logic uses the UTC date.**
    The injected clock is `new Date().toISOString()` (`vault-service.ts:60`) and every consumer slices the date: capture filenames, todo `resolved` stamps, overdue/today lanes. For a Swedish user, anything between local midnight and ~02:00 files under yesterday, and todo lanes flip hours late. Related: `note-status.ts:16-23` parses meeting dates as UTC while `MeetingWeek.tsx:31-44` deliberately parses local — sidebar and week grid can disagree. Pick local-date semantics once, at the `Clock` port.

17. **(FIXED — diacritics transliterated)** **Swedish characters destroyed by `slugify`/`norm`.**
    `domain/notes/slug.ts:57-65` strips non-ASCII: "Möte med Åsa" → `mte-med-sa`. Worse, link-repair's `norm()` (`link-repair.ts:20-27`) collapses distinct Swedish names, enabling falsely-confident tier-1 auto-repair matches. Use `\p{L}\p{N}` or transliterate å→a. Given the whole demo cast is Swedish, this bites daily.

18. **(FIXED — all four sub-items)** **Renderer batch/error handling gaps.**
    - Batch reject counts failures as successes (`InboxView.tsx:250-267`); batch accept continues past errors with no "3 of 6 failed" summary.
    - One-click permanent note delete in orphan ping rows with no confirm (`PingRows.tsx:142-146`) — inconsistent with the inline-confirm pattern NoteView/ChatsView established.
    - Chat scroll-jacks to bottom on every stream chunk (`ChatView.tsx:282-284`) — needs a "near bottom" guard.
    - Inbox keyboard mode is advertised but dead until the list is clicked — nothing focuses the scroller on mount (`InboxView.tsx:368, 391`).

### Low

19. **(FIXED — `secretsUnreadable` flag through SettingsDTO + warning banner; unreadable secrets now read as null, not `''`)** **safeStorage decrypt failure silently erases the API key** (`settings-service.ts:146-150`) — keychain reset makes the app act like no key was ever entered, no explanation. Surface a "re-enter your key" flag.
20. **(FIXED — commits on blur/Enter, reverts invalid input)** **MCP port input saves (and may rebind) on every keystroke** — typing "3000" persists ports 3, 30, 300, 3000 (`SettingsView.tsx:274-279`). Commit on blur/Enter.
21. **(FIXED — uses `dirForType` from @pm/domain)** **ContextView "See all" broken for wiki pages** — dir derived from the display label `'wiki pages'` never matches `wikipages/` (`ContextView.tsx:67,79`).
22. **(FIXED — failed bind already nulled `this.http`; a `close` listener now also covers post-bind death)** **MCP `isRunning()` can report true on a dead server** (`mcp-service.ts:43-55`); post-bind errors leave `this.http` set and `start()` early-returns forever.
23. **(FIXED — falls back to the skill name)** **Voice skill without `summary` injects `### undefined` into every outbound prompt** (`runtime.ts:292`).
24. **(FIXED — `will-quit` runs scheduler/MCP/agent/vault teardown; settings persist via tmp-file + rename)** **No quit path**: `dispose()`s are never called; `settings.json` is written non-atomically (`settings-service.ts:77-79`) — a crash mid-write loses vault path, keys, schedules, MCP token in one shot. Tmp-file + rename is cheap.
25. **(FIXED — result cached by a name:mtime:size dir signature, session-type marker cached per file; unchanged sidebar refresh costs a readdir + stats)** **`chats:list` re-reads every session transcript in full, synchronously, on every sidebar refresh** (`runtime.ts:361-375`). Read a head chunk or cache by mtime.
26. **(FIXED — all four: history shows a loading state, housekeeping rows collapse back, multi-file drops toast about the skipped files, Retry-After parses both forms)** **Small UI nits**: NoteHistory flashes "didn't exist at that commit" while loading (`NoteHistory.tsx:44-56`); housekeeping row expand is one-way (`CardItem.tsx:63-71`); multi-file drop silently keeps only the first file under a "Drop anything" banner (`App.tsx:173`, `CaptureDialog.tsx:191`); `Retry-After` HTTP-date values → `NaN` → zero backoff (`client.ts:116-117`).

---

## 2. Things to remove or cut

1. **The mocked Connections UI — the biggest honesty problem in the product.**
   `ConnectionsSettings.tsx` (384 polished lines) runs entirely against a local mock (`renderer/src/lib/connections.ts`, explicit "MOCK IPC SEAM" comment). Users can "connect" Jira, "follow" projects, and see "synced 4h ago" health lines that are fiction — there is no sync service in main. Either land the minimal read-only sync loop (phase 1 of `docs/jira-confluence-integration.md`) or gate the section behind a dev flag. Note the irony: the *hard* piece (wikipage-drift sweep, Area F) landed; the plumbing that feeds it real pages didn't.

2. **`packages/connectors` is entirely unwired** — zero imports outside the package (grep-verified). It also duplicates the outbound dispatch already living in `acceptOutbound`. Either wire it when Area C lands or park it; don't maintain two outbound dispatchers.

3. **~1,500 lines of dead UI primitives in `packages/ui`** — never referenced by the renderer (only barrel imports exist): `attachment`, `avatar`, `bubble`, `item`, `marker`, `message`, `input-group`, `table`, `toggle`, `toggle-group`, `scroll-area`, plus unused `Card*`, `Textarea`, `Tooltip*`, `DropdownMenu*`, `Tabs*`, `Empty`. Delete; git remembers.

4. **Approval telemetry in Settings** — approval rate / time-to-approve with no trend, no target, no action. Cut, or reduce to the one-liner the Inbox streak already does better.

5. **The approval streak itself** — it actively rewards fast approval, the exact rubber-stamp failure mode `docs/approval-review-redesign.md` warns about (and it currently deadlocks batch accept, bug 5). Keep the spot audit, drop the streak.

6. **Dead code (grep-verified, delete freely):** `AgentRuntime.isReady()`, `IpcHandlers` type in `packages/ipc`, `buildSessionReceipt`'s `sourceMeeting` param, `dto.ts:181` alias, `checkRawFrontmatterMutation` + `RAW_MUTABLE_FIELDS`, `OUTBOUND_SYSTEMS`/`OutboundSystem`, `isRawType`, `isOverdueTodo` (test-only), the dead ternary in `CaptureDialog.tsx:127-132`. `dev-seed.ts` (250 lines of demo fixtures) could become a dynamic `import()` to stay out of the prod bundle.

---

## 3. UX improvements

1. **First-run experience is the highest-leverage missing piece.** The core loop is invisible until minute ~10: no sample content for a fresh user (the excellent Tavla demo machinery is dev-only), and the Anthropic key — required for everything — is buried in Settings. Target flow: pick/create workspace → paste key → optional "load an example week" → drop first transcript.

2. **Close the capture → session → review loop visibly.** After a drop, nothing tells the user a session is running or where cards will appear. One post-capture toast/route ("Processing your meeting — watch it here") fixes it.

3. **Finish the "never expose storage" sweep — the rules are already written.** `docs/approval-review-redesign.md` says no paths/slugs/`.md`/markdown syntax anywhere; today NoteView shows the file path in monospace (~line 121), CaptureDialog says "Filed under sources/" (161-166), SkillsView shows `skills/`, InboxView copy contains `[[`. Either finish the sweep or soften the rule; the doc/UI contradiction is itself a coherence bug.

4. **Naming drift**: "Sessions" (ChatsView header) vs "Ask" (sidebar) vs "conversation"; "workspace" vs "vault" vs "folder of markdown" (Landing uses all three). Pick two words and sweep the copy — half a day, high trust payoff.

5. **Three entry points to session results** (Inbox "While you were away", ChatsView, sidebar Activity) with no hierarchy. Memory/docs say the Inbox is approvals-only; make it so, or brand it explicitly as "everything awaiting your glance".

6. **One-click revert from version history.** History is view-only; the product's pitch is "trust the agent because you approve" — the missing counterpart is "and you can undo." A restore button on the existing dialog completes the trust story.

7. **Smaller polish**: "Save as golden answer" force-navigates away from the chat (`ChatView.tsx:63-67`) — let them stay; body-save/rename/property rejections resync silently with zero feedback (`NoteView.tsx:231`, `PropertiesBlock.tsx:91-95`) — one toast each; `autoFocus` on FolderView filter and TodosView quick-add fights the same views' j/k navigation.

8. **SkillsView implies editability it doesn't have** — read-only dashboard where you must edit the underlying file. Add one small affordance (toggle `auto_apply` per binding) or label it inspection-only.

9. **Rename `.vault-dev` to a visible directory.** The hidden dot-dir is the single worst demo step (the ⌘⇧. picker ritual lives in README, the skill, and demo prep). One rename deletes it everywhere.

---

## 4. Refactors (highest-leverage only)

1. **`app-state.tsx` god store** (`state/app-state.tsx:1029-1096`): one context value with ~60 keys; every `session:status` tick re-renders every `useApp()` consumer. Cheap fix: split live/session state from vault/tab state into two providers.

2. **The 8 propose/draft tools each re-implement the same gate→parse→validate→createProposal→recordWrite pipeline** (`packages/agent/src/tools.ts:172-365, 382-511`). One `guardedProposalTool()` helper collapses ~150 lines — and this is the highest-traffic extension point (new skills → new tools).

3. **Triplicated proposal accept/reject plumbing** — `InboxView.tsx:169-267` and `SessionReview.tsx:35-86` implement the same busy/error/stale/receipt semantics independently, and SessionReview already drifted (no spot-audit, no receipts). Extract `useProposalActions(sessionId?)`.

4. **A `patchFrontmatterField` primitive** (splice one key into the raw YAML, like `writeBody` does for bodies) would make the whole freshness spine byte-safe and directly fixes bug 2's blast radius.

5. **`vault:changed` subscription churns**: the effect re-subscribes on every note load and reloads every note ever opened (`app-state.tsx:988-1027`) — after a git checkout or demo refresh that's N fetches for closed tabs. Key off open tabs, use a ref for the lookup.

6. **Duplicated helpers**: `freePath` copy-pasted (`notes.ts:28-36`, `todos.ts:32-40`); `saveGoldenAnswer` re-implements `slugify` inline (`proposals.ts:58-64`, inheriting the Swedish-chars bug).

7. **`handlers.ts` (550 lines)** is accreting non-handler logic (transcript-title race, notification plumbing, supersede-reaction dispatch). Extract the three self-contained blocks next time the file grows; not urgent.

---

## 5. Product gaps & design concerns

1. **Outbound execution is drafted, not delivered.** README promises "Slack/Jira drafts behind an approval floor", but no real outbound path is verified end-to-end against a live instance — and the one that exists (Confluence) is broken (bug 3). Verify one real path (a Jira comment) or label outbound cards "copies to clipboard" honestly.

2. **Path-as-identity leaks into durable stores.** `ProposalRecord.targetPath`, ping payloads, `sweep_checks` keys all carry file paths; a rename strands pending cards as "target not found" and nothing rewrites them. Fine at MVP scale, but each new durable surface deepens the cost of ever introducing a stable note id.

3. **Synced-folder guard.** Nothing stops a user pointing the app at a Dropbox/iCloud folder, where the SQLite index, git repo, and watcher will all misbehave. One warning ("this folder looks synced") is cheap insurance.

4. **MCP server is over-built for a single-user MVP** — serves an "external agents" persona that doesn't exist in the product story yet. Demote to an "Advanced" collapsed section; don't invest further.

5. **Outbound page cards have no staleness guard** — `zWikipage.version` is documented as the assertion token but `updatePage` blindly bumps the live version; drift cards are created with `baseHash: null` (`wikipage-drift.ts:401`). Vault-note cards have stale detection; the outside-world writes — the least reversible — have none.

---

## 6. Quality bar

- **No CI at all.** No `.github/workflows/`; `pnpm test` / `check-types` / `lint` run only when someone remembers — which is how the suite got red (bug 7) without anyone noticing. Half a day: one workflow running `check-types && test && lint` on push. This is the cheapest trust insurance available.
- **Test coverage is decent where it hurts** (17 files: vault containment/git guards, markdown round-trip, frontmatter merge, drift, sessions) — but the newest write path (`update`-card frontmatter merge) has exactly one test and its manual verification is still marked "to do" in `docs/commitment-check-redesign.md`. Given bugs 1–2 live exactly there, add invariant-enforcement tests to the accept path.
- **Zero renderer tests, no Electron boot smoke.** Acceptable for MVP; once CI exists, one Playwright smoke ("boots, opens vault, Inbox renders") would catch the packaging/ABI failure class that has bitten before.
- **No packaging story** (no electron-builder config) — fine pre-release; flag as a known scope boundary.

---

## Suggested order of attack

| # | Item | Size |
|---|------|------|
| 1 | Bugs 1–2: enforce invariants + use `writeBody`/`patchFrontmatterField` in accept paths | 1–2 days |
| 2 | Bug 3: make Confluence update replace (or disable drift-card outbound until it does) | ½–1 day |
| 3 | Bugs 4–5 + the red tests + CI workflow | 1 day |
| 4 | Gate or finish Connections; park `packages/connectors` | ½ day (gate) |
| 5 | Vault-switch teardown ordering (bug 6) + scheduler/settings session kills (bugs 8–9) | 1 day |
| 6 | First-run flow: key setup + example seed + post-capture thread | 2–3 days |
| 7 | Storage-exposure copy sweep + naming sweep + one-click revert | 1–2 days |
| 8 | Dead-code deletion (§2.3, §2.6) + timezone/slug fixes (bugs 16–17) | 1 day |
