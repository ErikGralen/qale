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
