# Sessions v2 — implementation notes

Companion to `sessions-v2.md` (the plan). Records what was built per phase, where the
implementation deviates from the plan and why, and the questions that came up while building
which are worth answering now that the code exists.

---

## Phase 0 — `dynamic` is real

**What changed**

- `isDynamicSkill(config)` (`packages/sessions/src/skill.ts`) — a skill is loadable on demand
  if it is a `guide` (reference is on-demand by definition, and the shipped guides declare no
  bindings) **or** it declares a `mode: dynamic` binding. This is the widening the plan asks
  for: before it, `describeBinding` rendered *"Available on demand"* into the Skills view for
  `synthesis` and `process-note`, and nothing could load them.
- `buildSkillBrief(config)` — the text a skill hands the model when it *arrives*, as opposed
  to being baked into the system prompt. A guide arrives as prose (`## Guide: …`); a session
  skill arrives as **rules now in force**, with its When/Read/Produce/Then, its guardrails and
  its checkpoint plan. Loading a session skill must not read as reference the model may weigh
  against what it was already told.
- `SessionHarness` now models "what is in force *now*" rather than a config frozen at session
  creation: `invoked[]`, `tier` (the highest any active skill grants), `checkpoints` /
  `gateOutput` (from the most recent arrival that declares a plan), `activeSkillName` (what
  cards are tagged with), `skillNames`.
- `advance_checkpoint` reads the plan live off the harness, and is registered for any session
  that can invoke skills — otherwise an arriving gate would lock proposing with no way past it.
- The session receipt records `skills: [chat, synthesis]` and a `Skills: chat → synthesis` line.

**Deviations / decisions**

- **An arrival raises the tier, never lowers it.** Invoking a read-only skill inside an
  outbound session does not strip the draft tools. Invariant 3 ("permissions attach to the
  material and the skill") is about a skill not being *able* to exceed what its material
  allows, not about arrivals being able to revoke. `external-transcript`'s "never propose a
  decision" survives as a red flag in prose, exactly as it does today.
- **A newly arrived checkpoint plan resets the counter.** A digest recorded against
  After-Meeting's plan must not unlock a gate Synthesis brought with it.
- **`use_skill` matches on the skill's invocation name first, filename second.** Guides used
  to be addressed by filename; both keep working.

**Known gap, closed in Phase 3:** raising the harness tier does not yet re-register the
propose/draft tools — the pi tool registry is fixed at session creation. Until Phase 3 an
arriving skill's *instructions* land but its *tools* do not.

---

## Phase 1 — session files

**What changed**

- `SESSION_FILES_DIR = 'sessions/.files'` + `isSessionFile()` in `@pm/domain`. The dot means
  `FsVault.walk` skips it at every level — zero indexer changes, as the plan verified.
- `session_files: true` frontmatter → `SkillConfig.sessionFiles`, `harness.sessionFiles`
  (true if *any* skill in force declares it). On for `chat` and `synthesis`, off for `ask`.
- `packages/agent/src/session-files.ts` — pi's read/write/edit/ls definitions rooted at
  `sessions/.files/<session-id>/` via injected operations, renamed `files_read` /
  `files_write` / `files_edit` / `files_list`, plus `listSessionFiles` / `readSessionFile`
  for the UI and a `sessionFilesPrompt()` block that states the layout convention and the
  citations-pass-through rule.
- `GitAdapter.ensureIgnored()` (additive, idempotent), seeded on `init` and re-applied on
  every `openVault` — a workspace that predates the feature must not start committing scratch.
- `validateEvidence` rejects any source resolving inside the session-files root (invariant 2),
  **including on inference cards**.
- Receipt gains a `Session files: N` line.
- UI: right-panel tree on session tabs (live via a new `session:files` push), a read-only
  `SessionFileView` tab with a muted "not part of your memory" strip, `sessions:files` /
  `sessions:fileText` IPC.

**Deviations / decisions**

- **`grep` and `find` are not offered.** The plan lists all six pi file tools as
  "configuration, not new tools", but `createGrepToolDefinition` / `createFindToolDefinition`
  shell out to ripgrep/fd with the resolved path — the injectable-operations guarantee that
  makes invariant 4 structural does not cover them, so a `path: "/etc"` would escape. A
  session folder is small; `files_list` + `files_read` covers it honestly. If grep becomes
  necessary, it needs its own implementation over `listSessionFiles`, not pi's.
- **The right panel only appears on a session tab once the session has files.** An empty 35%
  column on every ordinary chat would read as a broken feature.
- **The tree fills from a push, not a poll.** `onFilesChanged` fires from the write
  *operation*, after the bytes land and never on the refusal path.

**Open question surfaced while building:** nothing sweeps these files and nothing shows their
total size. The plan accepts that ("known debt"). The receipt count is the only trace; a size
readout in Settings is the obvious next move if it becomes real.

---

## Phase 2 — fan-out

**What changed**

- `packages/agent/src/spawn.ts` — `planSpawn()` expands the work list into concrete children
  (pure, so the card renders exactly what runs and nothing is re-derived after approval), and
  `createSpawnTool()` asks for approval, runs the batch and returns the rollup.
- `runChild()` in the runtime: a throwaway `createAgentSession()` on `SessionManager.inMemory()`
  with `CHILD_PREAMBLE`, vault read tools, session-folder read, and `write_result` — a subset of
  the parent's tools, never a superset. No propose, no draft, no outbound, ever.
- The spawn card: `session:spawn` push → `SpawnCard` inline in the chat (not a modal), with the
  work listed one line per entry, an expandable `brief.md`, and the model picker.
  `sessions:pendingSpawn` lets a reopened tab pick up a card that is still waiting.
- `sessionFilesPrompt` gained a "Working in parallel" section: write `brief.md` first, and say
  what you are about to do before the card appears.

**Deviations / decisions**

- **Children write via `write_result(content)`, not a scoped `files_write(path, content)`.** A
  single-argument tool has no path to get wrong, so "write only into your own file" is a shape
  rather than a rule. A child that reasons well but forgets the call still gets its closing text
  filed to the assigned path — the parent asked for a file.
- **`over: []` is an empty template, not a single child.** An entry whose target list came back
  empty means the scope found nothing; turning it into one child with no material would answer a
  question nobody asked. A batch that expands to zero children is refused with that explanation.
- **`{target}` is sanitized to one path segment.** `over: ['../../../etc/passwd']` interpolates
  to `passwd`, and `write_to` containing `..` is refused outright.
- **Hard ceilings**: `SPAWN_MAX_CHILDREN = 40` (a runaway is not a fan-out), `SPAWN_CONCURRENCY
  = 4` (above that it is queue depth, not speed). Both are constants, not settings, until
  someone hits them for a real reason.
- **`spawn` rides with `session_files`.** Children write into the folder and reading their
  output back is the whole point of having one, so a skill that declares one gets the other. The
  plan lists them as separate phases but not as separate switches.
- **No timeout on the approval card.** The answer is yes, no, or the PM stops the run; abort,
  delete and reconfigure all cancel pending cards, so nothing can hang forever.

**Open questions the plan raised, and where they landed**

- *"What happens to a fan-out when the app quits mid-run?"* — still open. Children are in-memory
  sessions: their written files survive, their in-flight work does not, and nothing marks the
  gap. The parent's rollup only counts children that returned, so a crash mid-batch reads as a
  smaller batch rather than a broken one.
- *"Cost ceiling — does the PM see a number they understand?"* — they see the child count and
  the model, which is what the plan's mockup shows. Not a token or currency estimate; that needs
  per-model pricing the app does not hold.

---

## Phase 3 — explicit invocation + mid-session activation

**The hard change, and how it was done**

pi's `tools:` option is an allowlist over the tool *registry*, not just the initial active set —
a tool missing from it can never be activated later. So a session now **registers everything a
skill could ever turn on** (propose, draft, checkpoint, use_skill, session files, spawn, plus
Atlassian when configured) and **activates only what the skills in force grant**, via
`session.setActiveToolsByName()`. `toolNamesFor()` now reads the *harness* (`tier`,
`checkpoints`, `sessionFiles`) instead of the config the session opened with.

The system prompt is mutable through the resource loader: `systemPromptOverride: () =>
systemPrompt` closes over a `let`, so appending an arriving skill's brief and calling
`loader.reload()` + `applyActivation()` puts the new rules in the system prompt itself.
`setActiveToolsByName` rebuilds the prompt from the loader, so those two must happen together —
they do, inside `state.invoke()`.

**Explicit invocation**

`AgentRunInput.invokeSkill` carries the PM's pick beside the prompt rather than inside it, so the
chat still shows what they actually typed and a replayed transcript is not polluted with an
injected preamble. `SkillPicker` in the composer lists every `skill_kind: session` skill; the
pick applies to the next message and then clears — a skill that stuck to the composer would be a
mode by another name, which is the thing being removed.

**Deviations / decisions**

- **The pick is per-message, not per-session.** Sticky would re-create modes.
- **An unresolvable skill name is skipped with a log, not thrown.** A stale picker entry must not
  kill the PM's message.
- **Invoking a skill already in force is a no-op**, so clicking an entry-point button twice does
  not stack duplicate instructions.
- **`ChatView` stopped deciding whether a session "proposes writes".** Any session may now
  propose, so `SessionReview` renders whenever cards exist and the Inbox refreshes after every
  settled turn.

---

## Phase 4 — session types dissolve

**What changed**

- Every session is created on `BASE_SKILL_NAME` (`chat`). The requested "session type" is applied
  as the **first invocation** on the first turn, through the same path as `use_skill` and the
  composer picker. Re-running with the same type is a no-op, so nothing stacks.
- `DEFAULT_SKILL_BY_TYPE` → `DEFAULT_SKILL_BY_NAME`; `resolveSkill(name)` resolves invocations,
  not session creation. Frontmatter `session_type` is now just the skill's name.
- `harness.primarySkillName` — the first skill that arrived, else the base — names the receipt.
  Memoized on first read: a skill invoked on turn five must not rename a receipt turns one to
  four already filed, orphaning the old path.
- `ask` gained a `dynamic` binding, so a cited answer can be asked for in the middle of any
  conversation instead of opening a different kind of tab.

**Entry points did not change.** The button on a meeting, the Landing tiles and the Skills view
are where they were and say what they said. They stop meaning *enter this mode* and start meaning
*start a session and invoke this skill* — same clicks, same names, and now a second skill can
arrive after the first.

**Deviations / decisions**

- **The Atlassian tools are available whenever configured**, not only in `ask`. With types
  dissolved there is no "the ask session" to hang them on, and every read they offer is
  non-mutating (`track_external` only starts a local mirror).
- **Voice registers are always in the system prompt.** They used to be gated on the session's
  tier being `outbound`, which is unknowable at creation now. They are short and inert until
  something drafts.
- **`session_files: false` for `ask` is unreachable.** The plan's table wants it off, but `ask`
  is now an invocation into a base that has files on, and arrivals only ever add. The property
  that actually matters — `ask` is observe-tier and proposes nothing — is preserved.
- **The `ViewBody` field is still called `sessionType`.** Renaming it to `skill` would need a
  migration for persisted tabs; its *meaning* is now "initial invocation", documented at both
  the type and the `ChatView` prop.

---

## Phase 5 — arrival: extraction vs analysis

**What changed**

- **One `arrival` skill** replaces `after-meeting`, `external-transcript` and `intake`. The branch
  was always data — who was in the room, what kind of thing it is — and both fields are already in
  the capture payload and matched by `bindingMatches`. `intake`'s own red flag used to say "if the
  PO was in the room, suggest re-filing it as a meeting", which is a session type whose job
  included telling you it was the wrong session type.
- **`interview-synthesis` is deleted.** It fired on arrival and produced insights — an analytical
  judgment about one document read in isolation. The memory's automatic intake was its
  lowest-quality content while its highest-quality content needed a human to go ask for it.
- **The `process` toggle** on the capture dialog: *"Anything to act on?"* Off files the document
  and runs nothing. Wired through `IngestCaptureInput.process` → `boundFollowUps`.
- **Retirement that actually retires.** `ensureDefaultSkills` now deletes a retired skill file from
  a workspace *only when its contents still match a version we shipped*, and refreshes a
  still-shipped skill whose copy matches an older shipped body (`DefaultSkill.previous`). The old
  bodies live in `packages/sessions/src/retired.ts` as dead-on-purpose strings. Without this,
  every existing workspace would run both the retired skill and its replacement on the same
  dropped transcript, and `chat` would keep its pre-v2 frontmatter — no session files, no fan-out.

**How invariant 3 survived the merge (the interesting part)**

`after-meeting` was `tier: outbound` with gates; `external-transcript` was `tier: suggest` with a
hard *never propose a decision* rule. One file has one `tier`, so merging them naively would have
demoted that difference from a tool-set fact to a sentence the model has to remember.

Instead, **bindings gained a `tier`**: `SkillBinding.tier` overrides the skill's own for the
material that binding matches. The arrival skill declares `tier: suggest` as its floor and gives
`origin: po` the `outbound` tier; the tier rides the `TriggeredSkill` → `IngestFollowUp` →
`AgentRunInput.invokeTier` path into the harness. A colleague's sales call literally does not have
the draft tools. Permissions attach to the material, structurally.

**Deviations / decisions**

- **`process-note` survives.** The plan left this open ("or does 'work this dump properly' become
  an explicit invocation?"). It is now *both*: it keeps its `dynamic` binding and, since Phase 3,
  is one click away in the composer picker. Nothing had to be cut.
- **Arrival keeps a gate**, `[digest, delta]` rather than after-meeting's three checkpoints —
  analysis moved out, so there is no outline stage. A one-line digest before proposing is cheap
  even for a screenshot, and it is what stops cards being fired without reading.
- **The default for `process` is on, and does not yet key off recency.** The plan wants a bulk
  historical import to default it off; there is no bulk-import path in the app today (captures
  arrive one at a time from the dialog or a shell drop), so there is nothing to detect. The toggle
  is in place and the moment a bulk path exists it should default off there.
- **Old session-type names stay recognised** in the Inbox grouping, the label map and
  `completeMeetingReview`, so cards and receipts a workspace already filed still read correctly.
